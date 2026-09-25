import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION } from "./config.js";
import { LodClient } from "./lod/client.js";
import { dictionarySource } from "./spell/speller.js";
import { registerCorpusTools } from "./tools/corpus.js";
import { registerLodTools } from "./tools/lod.js";
import { registerSpellTools } from "./tools/spell.js";

const INSTRUCTIONS = `Tools for Luxembourgish (Lëtzebuergesch) from the Zenter fir d'Lëtzebuerger Sprooch (ZLS).
- Look words up with lod_search (Luxembourgish, or from de/fr/en/pt via lang) and lod_get_entry; conjugations/declensions with lod_get_inflection.
- Proofread Luxembourgish with lb_spellcheck (spelling + n-rule hints); lb_n_rule_check for the Eifeler Regel only.
- Find real translated usage in context with corpus_search (LB/FR/DE/EN aligned corpus).
When writing or correcting Luxembourgish, prefer LOD spellings and translations over guesses, respect the n-rule, and cite lod.lu entries where helpful.`;

export const ABOUT = `# ZLS Lëtzebuergesch MCP server v${VERSION}

Resources used (all published by the Zenter fir d'Lëtzebuerger Sprooch):

| Resource | Access | Licence |
|---|---|---|
| Lëtzebuerger Online Dictionnaire (LOD) | live public API, https://lod.lu/api | CC0 |
| Spellchecker dictionary | ${dictionarySource()} | EUPL-1.1 |
| Méisproochegen Iwwersetzungskorpus fir d'Lëtzebuergescht | data.public.lu download, loaded locally | CC0 |

The n-rule (Eifeler Regel) checker is heuristic; LOD's nRuleForm is used to confirm cases when available.
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
              "1. Run lb_spellcheck (verify_with_lod=true).\n" +
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
