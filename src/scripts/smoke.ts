/**
 * Live smoke test against the real services (lod.lu, data.public.lu).
 *   npm run build && npm run smoke            # LOD + spellcheck
 *   npm run build && npm run smoke -- --corpus   # also downloads + searches the corpus
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

const withCorpus = process.argv.includes("--corpus");

const calls: Array<[string, Record<string, unknown>]> = [
  ["lod_search", { query: "Haus" }],
  ["lod_search", { query: "mécht" }],
  ["lod_search", { query: "Schmetterling", lang: "de" }],
  ["lod_search", { query: "voiture", lang: "fr", limit: 3 }],
  ["lod_get_entry", { id_or_word: "HAUS1", max_examples: 2 }],
  ["lod_get_entry", { id_or_word: "Päiperlek", languages: ["en", "fr"] }],
  ["lod_get_inflection", { id_or_word: "goen" }],
  ["lod_get_inflection", { id_or_word: "schéin" }],
  ["lb_spellcheck", { text: "Moien, ech wunnen zu Lezebuerg. Den Mann drénkt Kaffi a Uebst. Mir maachen Kaffi.", verify_with_lod: true }],
  ["lb_n_rule_check", { text: "Wann s de wëlls, kommen ech muer bei dech. De Hond leeft an de Gaart." }],
];
if (withCorpus) {
  calls.push(["corpus_search", { query: "Gesetz", limit: 3 }]);
  calls.push(["corpus_search", { query: "logement", lang: "fr", limit: 3 }]);
}

async function main() {
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smoke", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);

  let failures = 0;
  for (const [name, args] of calls) {
    const t0 = Date.now();
    const r: any = await client.callTool({ name, arguments: args });
    const ms = Date.now() - t0;
    const body = r.content.map((c: any) => c.text).join("\n");
    console.log(`\n=== ${name} ${JSON.stringify(args)}  (${ms} ms)${r.isError ? "  ❌ ERROR" : ""}`);
    console.log(body.length > 2500 ? body.slice(0, 2500) + "\n…[truncated]" : body);
    if (r.isError) failures++;
  }
  await client.close();
  console.log(`\n${calls.length - failures}/${calls.length} calls succeeded.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
