import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LodClient } from "../lod/client.js";
import { formatEntry, formatInflection, formatSearch } from "../lod/format.js";
import { LOD_LANGS, TARGET_LANGS } from "../lod/types.js";
import { json, safe, text, toolError } from "./util.js";

const READ_ONLY_REMOTE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const formatParam = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown (readable, default) or json (normalised structured data).");

export function registerLodTools(server: McpServer, lod: LodClient) {
  server.registerTool(
    "lod_search",
    {
      title: "Search the Luxembourgish dictionary (LOD)",
      description:
        "Search the Lëtzebuerger Online Dictionnaire (LOD), the official Luxembourgish dictionary of the Zenter fir d'Lëtzebuerger Sprooch. " +
        "With lang='lb' (default) it finds headwords AND inflected forms (e.g. 'mécht' → maachen, 'Haiser' → Haus). " +
        "With lang='de'|'fr'|'en'|'pt' it searches the translations, i.e. finds the Luxembourgish word for a German/French/English/Portuguese word, with a short sense label per meaning. " +
        "Returns LOD ids (e.g. HAUS1) for lod_get_entry / lod_get_inflection. Search is exact, not fuzzy: check spelling with lb_spellcheck first if unsure.",
      inputSchema: {
        query: z.string().min(1).max(100).describe("Word or short phrase to look up."),
        lang: z
          .enum(LOD_LANGS as unknown as [string, ...string[]])
          .default("lb")
          .describe("Language of the query: lb (Luxembourgish, default), de, fr, en, pt."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results to show."),
        format: formatParam,
      },
      annotations: { title: "LOD search", ...READ_ONLY_REMOTE },
    },
    safe(async ({ query, lang, limit, format }) => {
      const hits = await lod.search(query, lang as (typeof LOD_LANGS)[number]);
      if (format === "json") return json({ query, lang, total: hits.length, results: hits.slice(0, limit) });
      return text(formatSearch(query, lang, hits, limit));
    }),
  );

  server.registerTool(
    "lod_get_entry",
    {
      title: "Get a full LOD dictionary entry",
      description:
        "Fetch a Luxembourgish dictionary entry from LOD: part of speech, gender, IPA pronunciation, audio link, n-rule (Eifeler Regel) form, " +
        "every meaning with German/French/English/Portuguese translations and sense clarifiers, usage examples with glosses, synonyms and related words. " +
        "Accepts an LOD id (HAUS1) or a Luxembourgish word, including inflected forms (the best match is used and alternatives are listed).",
      inputSchema: {
        id_or_word: z.string().min(1).max(100).describe("LOD id like HAUS1, or a Luxembourgish word."),
        languages: z
          .array(z.enum(TARGET_LANGS))
          .min(1)
          .default([...TARGET_LANGS])
          .describe("Translation languages to include (default: de, fr, en, pt)."),
        include_examples: z.boolean().default(true).describe("Include usage examples."),
        max_examples: z.number().int().min(0).max(30).default(3).describe("Maximum examples per meaning."),
        format: formatParam,
      },
      annotations: { title: "LOD entry", ...READ_ONLY_REMOTE },
    },
    safe(async ({ id_or_word, languages, include_examples, max_examples, format }) => {
      const { entry, via, alternatives } = await lod.resolve(id_or_word);
      if (!entry) return toolError(`No LOD entry found for "${id_or_word}". Try lod_search, or check the spelling with lb_spellcheck.`);
      if (format === "json") {
        const { tables, ...rest } = entry;
        void tables;
        const trimmed = {
          ...rest,
          sections: rest.sections.map((s) => ({
            ...s,
            units: s.units.map((u) => ({
              ...u,
              meanings: u.meanings.map((m) => ({
                ...m,
                translations: Object.fromEntries(Object.entries(m.translations).filter(([l]) => (languages as string[]).includes(l))),
                examples: include_examples ? m.examples.slice(0, max_examples) : [],
              })),
            })),
          })),
        };
        return json({ entry: trimmed, resolvedFrom: via?.matchedForms, alternatives: alternatives.map((a) => ({ id: a.id, lemma: a.lemma, pos: a.posLabel })) });
      }
      let out = formatEntry(entry, { languages, includeExamples: include_examples, maxExamples: max_examples });
      if (via && via.lemma.toLowerCase() !== id_or_word.trim().toLowerCase()) {
        out = `(“${id_or_word}” resolved to the entry **${entry.lemma}**${via.matchedForms.length ? `; matched form: ${via.matchedForms.join(", ")}` : ""})\n\n` + out;
      }
      if (alternatives.length) {
        out += `\n\nOther possible entries: ${alternatives.map((a) => `${a.lemma} (${a.posLabel}, \`${a.id}\`)`).join("; ")}`;
      }
      return text(out);
    }),
  );

  server.registerTool(
    "lod_get_inflection",
    {
      title: "Get conjugation / declension tables from LOD",
      description:
        "Full inflection for a Luxembourgish word from LOD: verb conjugation (present, simple past, perfect, pluperfect, conditional, imperative; auxiliary hunn/sinn; past participle) " +
        "or adjective declension by gender/number/case with comparative and superlative; for nouns, the listed plural forms. Also returns the n-rule form. " +
        "Accepts an LOD id or a (possibly inflected) Luxembourgish word.",
      inputSchema: {
        id_or_word: z.string().min(1).max(100).describe("LOD id like MAACHEN1, or a Luxembourgish word."),
        format: formatParam,
      },
      annotations: { title: "LOD inflection", ...READ_ONLY_REMOTE },
    },
    safe(async ({ id_or_word, format }) => {
      const { entry } = await lod.resolve(id_or_word);
      if (!entry) return toolError(`No LOD entry found for "${id_or_word}".`);
      if (format === "json") return json({ id: entry.id, lemma: entry.lemma, pos: entry.pos, nRuleForm: entry.nRuleForm, tables: entry.tables ?? null });
      return text(formatInflection(entry));
    }),
  );
}
