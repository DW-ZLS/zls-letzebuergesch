import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CORPUS_LANGS, getCorpus, type CorpusLang } from "../corpus/loader.js";
import { highlight, searchCorpus } from "../corpus/search.js";
import { json, safe, text } from "./util.js";

const NAMES: Record<CorpusLang, string> = { lb: "LB", fr: "FR", de: "DE", en: "EN" };

export const CORPUS_ATTRIBUTION =
  "Source: Méisproochegen Iwwersetzungskorpus fir d'Lëtzebuergescht, Zenter fir d'Lëtzebuerger Sprooch — data.public.lu, CC0. Professional human translations.";

export function registerCorpusTools(server: McpServer) {
  server.registerTool(
    "corpus_search",
    {
      title: "Search the ZLS Luxembourgish–French–German–English translation corpus",
      description:
        "Find real, professionally translated sentences in the ZLS multilingual corpus (~150,000 Luxembourgish words aligned with French, German and English; news, parliamentary and dictionary material, standard orthography). " +
        "Search in any of the four languages and get the aligned segments in the others — useful for checking how a word or phrase is used and translated in context, " +
        "and for finding the Luxembourgish equivalent of a French/German/English expression. The first call may take a few seconds while the corpus loads.",
      inputSchema: {
        query: z.string().min(2).max(200).describe("Word or phrase to find."),
        lang: z.enum(CORPUS_LANGS as unknown as [CorpusLang, ...CorpusLang[]]).default("lb").describe("Language the query is in: lb, fr, de, en."),
        show_langs: z
          .array(z.enum(CORPUS_LANGS as unknown as [CorpusLang, ...CorpusLang[]]))
          .min(1)
          .default([...CORPUS_LANGS])
          .describe("Which aligned languages to display (default all four)."),
        match: z.enum(["word", "substring"]).default("word").describe("word = whole-word/phrase match (default); substring = also inside longer words, e.g. compounds."),
        case_sensitive: z.boolean().default(false),
        ignore_accents: z.boolean().default(false).describe("Treat ë/e, é/e etc. as equal. Off by default (diacritics matter in Luxembourgish)."),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).default(0).describe("For paging through results."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: {
        title: "Corpus search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(async (a) => {
      const corpus = await getCorpus();
      const { total, hits } = searchCorpus(corpus, {
        query: a.query,
        lang: a.lang,
        match: a.match,
        caseSensitive: a.case_sensitive,
        ignoreAccents: a.ignore_accents,
        limit: a.limit,
        offset: a.offset,
      });
      if (a.format === "json") {
        return json({ query: a.query, lang: a.lang, total, offset: a.offset, results: hits.map((h) => ({ id: h.segment.id, text: h.segment.text, meta: h.segment.meta })) });
      }
      if (!total) {
        return text(
          `No segments in the corpus contain “${a.query}” (${NAMES[a.lang]}, ${a.match} match).` +
            (a.match === "word" ? " Try match='substring' to include compounds and inflected forms." : "") +
            `\n\n${CORPUS_ATTRIBUTION}`,
        );
      }
      const L = [`Corpus: ${total} segment(s) with “${a.query}” in ${NAMES[a.lang]}; showing ${a.offset + 1}–${a.offset + hits.length} (shortest first).`];
      for (const h of hits) {
        L.push("");
        for (const lang of a.show_langs) {
          const t = h.segment.text[lang];
          if (!t) continue;
          L.push(`- ${NAMES[lang]}: ${lang === a.lang ? highlight(t, h.ranges) : t}`);
        }
      }
      if (a.offset + hits.length < total) L.push("", `More results: call again with offset=${a.offset + hits.length}.`);
      L.push("", CORPUS_ATTRIBUTION);
      return text(L.join("\n"));
    }),
  );
}
