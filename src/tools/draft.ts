import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CORPUS_LANGS, getCorpus, type CorpusLang } from "../corpus/loader.js";
import { findSimilar, splitSentences } from "../corpus/similar.js";
import { checkGrammar, type GrammarIssue } from "../grammar/checks.js";
import { LodLexicon } from "../grammar/lexicon.js";
import { grammarNotes } from "../grammar/resources.js";
import type { LodClient } from "../lod/client.js";
import { checkNRule, type NRuleIssue } from "../spell/nrule.js";
import { getSpeller, isCorrect, spellcheck, type SpellIssue } from "../spell/speller.js";
import { CORPUS_ATTRIBUTION } from "./corpus.js";
import { makeLodNRuleLookup } from "./spell.js";
import { json, safe, text } from "./util.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const KIND_TITLE: Record<GrammarIssue["kind"], string> = {
  germanism: "German instead of Luxembourgish",
  gender: "Article ↔ gender (from LOD)",
  case: "Case (dative after preposition)",
  auxiliary: "Perfect tense auxiliary hunn/sinn (from LOD)",
  contraction: "Contraction",
};
const RANK = { high: 0, medium: 1, low: 2 } as const;

function lineCol(src: string, offset: number): string {
  const before = src.slice(0, offset);
  return `${before.split("\n").length}:${offset - before.lastIndexOf("\n")}`;
}

export interface DraftReport {
  spelling: SpellIssue[];
  grammar: GrammarIssue[];
  nRule: NRuleIssue[];
  wordCount: number;
}

export async function checkDraft(src: string, lod: LodClient, opts: { verify: boolean; ignore: Set<string> }): Promise<DraftReport> {
  const { issues: spelling, wordCount } = await spellcheck(src, { maxSuggestions: 4, ignore: opts.ignore, skipAcronyms: true, skipCapitalized: false });
  const sp = await getSpeller();
  const lexicon = new LodLexicon(lod);
  const [grammar, nRuleAll] = await Promise.all([
    checkGrammar(src, { lexicon, unknownWords: spelling, maxLookups: opts.verify ? 60 : 0 }),
    checkNRule(src, { isWord: (w) => isCorrect(sp, w), lodNRuleForm: opts.verify ? makeLodNRuleLookup(lod) : undefined, lodBudget: 10 }),
  ]);
  const misspelled = new Set(spelling.map((s) => s.start));
  // n-rule hints on words that the auxiliary check already rewrites are redundant
  const auxStarts = new Set(grammar.filter((g) => g.kind === "auxiliary").map((g) => g.start));
  const nRule = nRuleAll.filter((n) => !misspelled.has(n.start) && !auxStarts.has(n.start));
  return { spelling, grammar, nRule, wordCount };
}

export function formatDraftReport(src: string, r: DraftReport): string {
  const germanismStarts = new Set(r.grammar.filter((g) => g.kind === "germanism").map((g) => g.start));
  const spelling = r.spelling.filter((s) => !germanismStarts.has(s.start));
  const all = [...r.grammar.map((g) => g.confidence), ...r.nRule.map((n) => n.confidence), ...spelling.map(() => "high" as const)];
  const high = all.filter((c) => c === "high").length;
  const L: string[] = [];
  L.push(
    all.length
      ? `**${all.length} finding(s), ${high} high-confidence**, in ${r.wordCount} words. Fix high and medium items, then run lb_check_draft again.`
      : `No findings in ${r.wordCount} words. (Not checked: word order, idiom, register. Compare with corpus_similar_sentences if unsure.)`,
  );

  const groups = new Map<GrammarIssue["kind"], GrammarIssue[]>();
  for (const g of r.grammar) groups.set(g.kind, [...(groups.get(g.kind) ?? []), g]);
  for (const kind of ["germanism", "auxiliary", "gender", "case", "contraction"] as const) {
    const items = (groups.get(kind) ?? []).sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.start - b.start);
    if (!items.length) continue;
    L.push("", `### ${KIND_TITLE[kind]}`);
    for (const g of items) L.push(`- [${g.confidence}] **${g.text}** → **${g.suggestion}** — ${g.message} (${lineCol(src, g.start)})`);
  }
  if (spelling.length) {
    L.push("", "### Unknown words (not in the ZLS spelling dictionary)");
    for (const s of spelling) L.push(`- **${s.word}** → ${s.suggestions.length ? s.suggestions.join(", ") : "no suggestion; look it up with lod_search (lang=de/fr/en) instead of guessing"} (${lineCol(src, s.start)})`);
  }
  if (r.nRule.length) {
    L.push("", "### n-rule (Eifeler Regel)");
    for (const n of r.nRule.sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.start - b.start)) {
      L.push(`- [${n.confidence}${n.lodConfirmed ? ", LOD" : ""}] **${n.word}** ${n.nextWord} → **${n.suggestion}** ${n.nextWord} (${lineCol(src, n.start)})`);
    }
  }
  L.push(
    "",
    "---",
    "Checks: ZLS spelling dictionary, LOD genders/auxiliaries/translations, n-rule, dative after mat/vun/bei/zu/no/aus/zënter. " +
      "Not checked: word order, idiom, register, tense choice. For those, compare with real sentences from corpus_similar_sentences and follow lb_writing_guide.",
  );
  return L.join("\n");
}

export function registerDraftTools(server: McpServer, lod: LodClient) {
  server.registerTool(
    "lb_writing_guide",
    {
      title: "Luxembourgish writing rules (read before writing)",
      description:
        "Short rules for writing correct Luxembourgish instead of German-influenced 'pseudo-Luxembourgish': articles and gender, dative, hunn/sinn, " +
        "past tense, conditional, n-rule, typical Germanisms. Maintained by the ZLS. Call this ONCE per conversation before you write, translate into or correct Luxembourgish.",
      inputSchema: {},
      annotations: { title: "Writing guide", ...RO, openWorldHint: false },
    },
    async () => text(grammarNotes()),
  );

  server.registerTool(
    "lb_check_draft",
    {
      title: "Check a Luxembourgish draft (spelling, grammar, Germanisms, n-rule)",
      description:
        "ALWAYS run this on any Luxembourgish text you wrote or translated before showing it to the user, then fix the findings and run it again. " +
        "Combines: ZLS spelling dictionary; German words written as Luxembourgish, with the real Luxembourgish word from LOD (Wetter → Wieder, getrunken → gedronk); " +
        "wrong auxiliary (hunn/sinn) using LOD's data per verb (e.g. *hunn … gaangen* → *si … gaangen*); article–noun gender from LOD (*de Stad* → *d'Stad*); " +
        "dative after mat/vun/bei/zu/no/aus (*mat meng Frënn* → *mat menge Frënn*); n-rule. Findings carry confidence levels (high/medium/low).",
      inputSchema: {
        text: z.string().min(1).max(20_000).describe("The Luxembourgish draft."),
        verify_with_lod: z.boolean().default(true).describe("Use LOD for gender, auxiliary, Germanism and n-rule checks (recommended)."),
        ignore_words: z.array(z.string()).max(500).default([]).describe("Names or jargon to accept."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: { title: "Check Luxembourgish draft", ...RO, openWorldHint: true },
    },
    safe(async ({ text: src, verify_with_lod, ignore_words, format }) => {
      const report = await checkDraft(src, lod, { verify: verify_with_lod, ignore: new Set(ignore_words.map((w) => w.toLowerCase())) });
      if (format === "json") return json(report);
      return text(formatDraftReport(src, report));
    }),
  );

  server.registerTool(
    "corpus_similar_sentences",
    {
      title: "Find similar professionally translated sentences",
      description:
        "Given a sentence or short text (in French, German, English or Luxembourgish), return the most similar real segments from the ZLS translation corpus " +
        "with their aligned Luxembourgish/French/German/English versions. Use it BEFORE translating into Luxembourgish, to copy authentic phrasing, word choice and structure " +
        "from professional translations instead of improvising. Longer texts are split into sentences (max 6).",
      inputSchema: {
        text: z.string().min(3).max(3000).describe("Source sentence(s)."),
        lang: z.enum(CORPUS_LANGS as unknown as [CorpusLang, ...CorpusLang[]]).describe("Language of the given text: fr, de, en or lb."),
        per_sentence: z.number().int().min(1).max(10).default(3).describe("Matches per sentence."),
        show_langs: z
          .array(z.enum(CORPUS_LANGS as unknown as [CorpusLang, ...CorpusLang[]]))
          .min(1)
          .optional()
          .describe("Languages to display (default: the source language and lb)."),
      },
      annotations: { title: "Similar sentences", ...RO, openWorldHint: false },
    },
    safe(async ({ text: src, lang, per_sentence, show_langs }) => {
      const corpus = await getCorpus();
      const langs = show_langs ?? [...new Set<CorpusLang>([lang, "lb"])];
      const sentences = src.length > 250 ? splitSentences(src) : [src];
      const seen = new Set<number>();
      const L: string[] = [];
      for (const s of sentences) {
        const hits = findSimilar(corpus, s, lang, per_sentence, seen);
        if (sentences.length > 1) L.push("", `#### “${s.length > 90 ? s.slice(0, 90) + "…" : s}”`);
        if (!hits.length) {
          L.push("(no similar segment)");
          continue;
        }
        for (const h of hits) {
          seen.add(h.segment.id);
          L.push("");
          for (const l of langs) if (h.segment.text[l]) L.push(`- ${l.toUpperCase()}: ${h.segment.text[l]}`);
        }
      }
      L.push("", "Reuse structures and vocabulary from the LB lines; they are professional translations in standard orthography.", CORPUS_ATTRIBUTION);
      return text(L.join("\n").trim());
    }),
  );
}
