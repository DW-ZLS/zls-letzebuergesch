import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION } from "./config.js";
import { LodClient } from "./lod/client.js";
import { dictionarySource } from "./spell/speller.js";
import { registerCorpusTools } from "./tools/corpus.js";
import { registerDraftTools } from "./tools/draft.js";
import { registerLodTools } from "./tools/lod.js";
import { registerSpellTools } from "./tools/spell.js";

const INSTRUCTIONS = `Tools for Luxembourgish (Lëtzebuergesch) from the Zenter fir d'Lëtzebuerger Sprooch (ZLS).

WHENEVER you write, translate into or correct Luxembourgish, follow this workflow — AI models tend to produce German-influenced "pseudo-Luxembourgish":
1. Call lb_writing_guide once per conversation and follow its rules.
2. When translating from French/German/English, first call corpus_similar_sentences with the source text and reuse the phrasing of the professional Luxembourgish translations.
3. Never adapt a German word to Luxembourgish spelling. Look up every word you are not certain of with lod_search (lang=de/fr/en for the Luxembourgish equivalent). Use lod_get_inflection for participles and conjugations, and check noun genders in LOD.
4. Draft, then run lb_check_draft. Fix every high/medium finding, and run it again until it is clean. Never show the user unchecked Luxembourgish.
Other tools: lod_get_entry (meanings, examples, pronunciation), corpus_search (a word/phrase in context), lb_spellcheck / lb_n_rule_check (quick checks).`;

export const ABOUT = `# ZLS Lëtzebuergesch MCP server v${VERSION}

Resources used (all published by the Zenter fir d'Lëtzebuerger Sprooch):

| Resource | Access | Licence |
|---|---|---|
| Lëtzebuerger Online Dictionnaire (LOD) | live public API, https://lod.lu/api | CC0 |
| Spellchecker dictionary | ${dictionarySource()} | EUPL-1.1 |
| Méisproochegen Iwwersetzungskorpus fir d'Lëtzebuergescht | data.public.lu download, loaded locally | CC0 |

The n-rule (Eifeler Regel) checker is heuristic; LOD's nRuleForm is used to confirm cases when available.\nGrammar checks (gender, auxiliary, dative, Germanisms) use LOD data plus the ZLS-maintained files resources/grammar-notes.md and resources/germanisms.tsv.
No user text is stored. Spellchecking and corpus search run locally in the server; dictionary lookups send only the looked-up word to lod.lu.`;

export function createServer(opts: { lod?: LodClient } = {}): McpServer {
  const lod = opts.lod ?? new LodClient();
  const server = new McpServer(
    { name: "zls-letzebuergesch", title: "ZLS – Lëtzebuergesch", version: VERSION },
    { instructions: INSTRUCTIONS, capabilities: { logging: {} } },
  );

  registerLodTools(server, lod);
  registerSpellTools(server, lod);
  registerCorpusTools(server);
  registerDraftTools(server, lod);

  server.registerResource(
    "about",
    "zls://about",
    { title: "About this server, sources and licences", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: ABOUT }] }),
  );

  server.registerPrompt(
    "proofread_luxembourgish",
    {
      title: "Proofread a Luxembourgish text",
      description: "Proofread Luxembourgish text using the ZLS spellchecker, the n-rule checker and the LOD dictionary.",
      argsSchema: { text: z.string().describe("The Luxembourgish text to proofread.") },
    },
    ({ text }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Proofread the following Luxembourgish text according to the official ZLS orthography.\n" +
              "1. Run lb_check_draft.\n" +
              "2. For doubtful words, confirm with lod_search / lod_get_entry.\n" +
              "3. Return the corrected text, then a short list of changes with reasons (spelling, n-rule, other). " +
              "Do not change style or wording beyond orthography unless something is clearly wrong.\n\n" +
              `Text:\n"""\n${text}\n"""`,
          },
        },
      ],
    }),
  );

  return server;
}
