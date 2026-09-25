import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LodClient } from "../lod/client.js";
import { germanisms } from "../grammar/resources.js";
import { checkNRule, type NRuleIssue } from "../spell/nrule.js";
import { dictionarySource, getSpeller, isCorrect, spellcheck, type SpellIssue } from "../spell/speller.js";
import { json, safe, text } from "./util.js";

const MAX_CHARS = 20_000;

function lineCol(src: string, offset: number): string {
  const before = src.slice(0, offset);
  const line = before.split("\n").length;
  const col = offset - before.lastIndexOf("\n");
  return `${line}:${col}`;
}

function context(src: string, start: number, end: number): string {
  const a = Math.max(0, start - 30);
  const b = Math.min(src.length, end + 30);
  return `${a > 0 ? "…" : ""}${src.slice(a, start)}[${src.slice(start, end)}]${src.slice(end, b)}${b < src.length ? "…" : ""}`.replace(/\s+/g, " ");
}

/** LOD-backed nRuleForm lookup: string = n-rule form, null = lemma exists without one, undefined = no exact lemma. */
export function makeLodNRuleLookup(lod: LodClient) {
  return async (word: string): Promise<string | null | undefined> => {
    try {
      const hits = await lod.search(word, "lb");
      const exact = hits.find((h) => h.lemma.toLowerCase() === word.toLowerCase() && !h.erroneous);
      if (!exact) return undefined;
      const entry = await lod.entry(exact.id);
      return entry?.nRuleForm ?? null;
    } catch {
      return undefined; // LOD unreachable → behave as offline
    }
  };
}

function formatSpelling(src: string, issues: SpellIssue[], wordCount: number): string[] {
  if (!issues.length) return [`Spelling: no unknown words (${wordCount} words checked).`];
  const L = [`Spelling: ${issues.length} unknown word(s) out of ${wordCount}:`];
  for (const i of issues) {
    L.push(`- **${i.word}** (${lineCol(src, i.start)}) → ${i.suggestions.length ? i.suggestions.join(", ") : "no suggestion"}  ·  ${context(src, i.start, i.end)}`);
  }
  return L;
}

function formatNRule(src: string, issues: NRuleIssue[]): string[] {
  if (!issues.length) return ["n-rule (Eifeler Regel): no issues found."];
  const L = [`n-rule (Eifeler Regel): ${issues.length} hint(s) — heuristic, please review:`];
  for (const i of issues) {
    const arrow = i.direction === "drop-n" ? "drop the n" : "keep/add the n";
    L.push(
      `- [${i.confidence}${i.lodConfirmed ? ", LOD-confirmed" : ""}] **${i.word}** ${i.nextWord} → **${i.suggestion}** ${i.nextWord} (${arrow}; ${i.reason}) (${lineCol(src, i.start)})`,
    );
  }
  return L;
}

export function registerSpellTools(server: McpServer, lod: LodClient) {
  server.registerTool(
    "lb_spellcheck",
    {
      title: "Check Luxembourgish spelling",
      description:
        "Proofread Luxembourgish text against the official orthography: flags unknown words with suggestions (spellchecker.lu Hunspell dictionary, ZLS) " +
        "and, by default, adds n-rule (Eifeler Regel) hints — e.g. 'den Mann' → 'de Mann', 'e Apel' → 'en Apel'. " +
        "Handles elisions (d'Kanner, z'Lëtzebuerg) and hyphenated compounds. Up to 20,000 characters per call. " +
        "The spelling check is dictionary-based; n-rule hints are heuristic and carry a confidence level.",
      inputSchema: {
        text: z.string().min(1).max(MAX_CHARS).describe("Luxembourgish text to check."),
        check_n_rule: z.boolean().default(true).describe("Also report n-rule (Eifeler Regel) hints."),
        verify_with_lod: z
          .boolean()
          .default(false)
          .describe("Confirm uncertain n-rule hints against LOD's nRuleForm (slower: up to 15 extra dictionary lookups)."),
        max_suggestions: z.number().int().min(0).max(10).default(5),
        ignore_words: z.array(z.string()).max(500).default([]).describe("Words to accept as correct (names, jargon)."),
        skip_capitalized: z
          .boolean()
          .default(false)
          .describe("Skip capitalised words that are not sentence-initial (proper names). Off by default because Luxembourgish nouns are capitalised."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: {
        title: "Luxembourgish spellcheck",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(async ({ text: src, check_n_rule, verify_with_lod, max_suggestions, ignore_words, skip_capitalized, format }) => {
      const ignore = new Set(ignore_words.map((w) => w.toLowerCase()));
      const { issues, wordCount } = await spellcheck(src, {
        maxSuggestions: max_suggestions,
        ignore,
        skipAcronyms: true,
        skipCapitalized: skip_capitalized,
      });
      // German words: put the curated Luxembourgish equivalent first
      const gl = germanisms();
      for (const i of issues) {
        const m = /^([dDzZ]['’])?(.+)$/.exec(i.word)!;
        const hit = gl.get(m[2].toLowerCase());
        if (hit) i.suggestions = [...hit.lb.split(/,\s*/).map((x) => (m[1] ?? "") + x), ...i.suggestions.filter((x) => !hit.lb.includes(x))].slice(0, Math.max(1, max_suggestions));
      }
      let nrule: NRuleIssue[] = [];
      if (check_n_rule) {
        const sp = await getSpeller();
        const misspelled = new Set(issues.map((i) => i.start));
        nrule = (
          await checkNRule(src, {
            isWord: (w) => isCorrect(sp, w),
            lodNRuleForm: verify_with_lod ? makeLodNRuleLookup(lod) : undefined,
          })
        ).filter((n) => !misspelled.has(n.start));
      }
      if (format === "json") return json({ wordCount, spelling: issues, nRule: check_n_rule ? nrule : undefined, dictionary: dictionarySource() });
      const out = [...formatSpelling(src, issues, wordCount)];
      if (check_n_rule) out.push("", ...formatNRule(src, nrule));
      out.push("", `Dictionary: ${dictionarySource()}.`);
      return text(out.join("\n"));
    }),
  );

  server.registerTool(
    "lb_n_rule_check",
    {
      title: "Check the n-rule (Eifeler Regel)",
      description:
        "Check only the Luxembourgish n-rule (Eifeler Regel): final -n/-nn is kept before vowels, n, d, t, z, h and before a pause, and dropped before other consonants. " +
        "Returns hints with confidence levels (high = known function word or LOD-confirmed; medium/low = heuristic). " +
        "Set verify_with_lod=true to confirm uncertain cases against the dictionary's official n-rule forms.",
      inputSchema: {
        text: z.string().min(1).max(MAX_CHARS),
        verify_with_lod: z.boolean().default(true),
        min_confidence: z.enum(["low", "medium", "high"]).default("low"),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: {
        title: "n-rule check",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safe(async ({ text: src, verify_with_lod, min_confidence, format }) => {
      const sp = await getSpeller();
      const rank = { low: 0, medium: 1, high: 2 } as const;
      const issues = (
        await checkNRule(src, {
          isWord: (w) => isCorrect(sp, w),
          lodNRuleForm: verify_with_lod ? makeLodNRuleLookup(lod) : undefined,
        })
      ).filter((i) => rank[i.confidence] >= rank[min_confidence]);
      if (format === "json") return json({ issues });
      return text(
        [
          ...formatNRule(src, issues),
          "",
          "Rule: keep final -n before a vowel, n, d, t, z, h or a pause; drop it before other consonants. Numbers, acronyms and words starting with y are skipped because it depends on pronunciation.",
        ].join("\n"),
      );
    }),
  );
}
