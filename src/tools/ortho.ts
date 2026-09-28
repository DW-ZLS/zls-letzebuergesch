import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cite, formatSection, getSection, loadRules, ORTHO_SOURCE, searchRules, sectionsForWord } from "../ortho/rules.js";
import { json, safe, text, toolError } from "./util.js";

export function registerOrthographyTools(server: McpServer) {
  server.registerTool(
    "lb_orthography_rules",
    {
      title: "Look up the official Luxembourgish orthography rules",
      description:
        "Search or read the official spelling rules, D’Lëtzebuerger Orthografie (CPLL/ZLS, 183 paragraphs). It covers vowel length and doubling, ee/é/ë, " +
        "diphthongs and the r-rule, consonants (ck/tz, ss/ß, g/ch, final devoicing), verbs, the n-rule (Eifeler Regel), French/English/Greek loanwords, capitalisation, " +
        "writing words together or apart, hyphens, and punctuation. Use it whenever you are unsure how to write something, and to justify corrections with the paragraph (§). " +
        "Give ONE of: `section` (e.g. '6.1.2.2' or '8.3'), `query` (a topic or question in any language, e.g. 'Komma virun datt', 'capital letters for days of the week', 'ee oder é'), " +
        "or `word` (find the rules that use this word as an example, e.g. 'Wäin').",
      inputSchema: {
        section: z.string().max(20).optional().describe("Paragraph number, e.g. 6.1.2.2."),
        query: z.string().max(300).optional().describe("Topic or question."),
        word: z.string().max(60).optional().describe("A Luxembourgish word or phrase used as an example in the rules."),
        limit: z.number().int().min(1).max(8).default(3).describe("Maximum number of paragraphs returned for query/word."),
        include_subsections: z.boolean().default(true).describe("For `section`: also return the text of the direct subsections."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: { title: "Orthography rules", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ section, query, word, limit, include_subsections, format }) => {
      if (!loadRules().order.length) return toolError("The orthography rules are not installed (resources/orthografie/reegelen.jsonl missing).");
      if (section) {
        const s = getSection(section);
        if (!s) return toolError(`No paragraph §${section}. Chapters: 1 Vokaler a/i/o/u, 2 e, 3 Diphthongen, 4 Konsonanten, 5 Verben, 6 n-Reegel, 7 Friemwierder, 8 Grouss-/Klengschreiwung, 9 Getrennt-/Zesummeschreiwung, 10 Interpunktioun.`);
        if (format === "json") return json({ section: s, subsections: include_subsections ? s.subsections.map((x) => getSection(x)) : undefined, citation: cite(s) });
        return text(formatSection(s, { withChildren: include_subsections, maxChars: 9000 }));
      }
      if (word) {
        const hits = sectionsForWord(word).slice(0, limit);
        if (!hits.length) {
          const alt = searchRules(word, limit);
          if (!alt.length) return text(`“${word}” is not used as an example in the rules. Try a topic with \`query\`, or check the word with lb_spellcheck / lod_search.`);
          return text([`“${word}” is not listed as an example; the closest paragraphs:`, "", ...alt.map((h) => formatSection(h.section, { maxChars: 2500 }))].join("\n\n"));
        }
        if (format === "json") return json({ word, sections: hits.map((h) => ({ ...h, citation: cite(h) })) });
        return text([`“${word}” appears as an example in ${hits.length} paragraph(s):`, "", ...hits.map((h) => formatSection(h, { maxChars: 3000 }))].join("\n\n"));
      }
      if (query) {
        const hits = searchRules(query, limit);
        if (!hits.length) return text("No matching paragraph. Try other keywords (in Luxembourgish, e.g. 'Grouss', 'Komma', 'Bindestréch', 'n-Reegel', 'Friemwierder').");
        if (format === "json") return json({ query, results: hits.map((h) => ({ ...h.section, score: h.score, citation: cite(h.section) })) });
        return text(hits.map((h) => formatSection(h.section, { maxChars: 3000 })).join("\n\n---\n\n"));
      }
      // no argument: table of contents
      const idx = loadRules();
      const toc = idx.order.filter((id) => id.split(".").length <= 2).map((id) => {
        const s = idx.sections.get(id)!;
        return `${"  ".repeat(id.split(".").length - 1)}- §${id} ${s.title} (S. ${s.page})`;
      });
      return text([`# ${ORTHO_SOURCE}: contents`, "", ...toc, "", "Call again with `section`, `query` or `word`."].join("\n"));
    }),
  );

  server.registerResource(
    "orthography-digest",
    "zls://orthografie/digest",
    { title: "Official orthography: key rules", mimeType: "text/markdown" },
    async (uri) => {
      const { orthographyDigest } = await import("../grammar/resources.js");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: orthographyDigest() }] };
    },
  );
}
