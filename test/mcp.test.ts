import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTmx, setCorpusForTesting } from "../src/corpus/loader.js";
import { LodClient } from "../src/lod/client.js";
import { createServer } from "../src/server.js";
import { fakeLod, fixture } from "./helpers.js";

let client: Client;

beforeAll(async () => {
  const segments = parseTmx(fixture("corpus_sample.tmx"));
  setCorpusForTesting({ segments, source: "fixture", files: ["fixture"], counts: { lb: 4, fr: 3, de: 3, en: 2 } });
  const server = createServer({ lod: new LodClient(fakeLod().fetch, "https://lod.test/api/lb") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
}, 30_000);

afterAll(() => setCorpusForTesting(null));

const textOf = (r: any) => r.content.map((c: any) => c.text).join("\n");

describe("MCP protocol", () => {
  it("lists the tools with read-only annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["corpus_search", "corpus_similar_sentences", "lb_check_draft", "lb_n_rule_check", "lb_spellcheck", "lb_writing_guide", "lod_get_entry", "lod_get_inflection", "lod_search"].sort(),
    );
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.title).toBeTruthy();
    }
  });

  it("lod_search", async () => {
    const r = await client.callTool({ name: "lod_search", arguments: { query: "house", lang: "en" } });
    expect(textOf(r)).toContain("HAUS1");
  });

  it("lod_get_entry by inflected word", async () => {
    const r = await client.callTool({ name: "lod_get_entry", arguments: { id_or_word: "mécht", languages: ["en"] } });
    const t = textOf(r);
    expect(t).toContain("resolved to the entry **maachen**");
    expect(t).toContain("EN: to do [an activity]; to make [an application, an outing]");
    expect(t).not.toContain("FR:");
  });

  it("lod_get_entry json format", async () => {
    const r = await client.callTool({ name: "lod_get_entry", arguments: { id_or_word: "HAUS1", format: "json" } });
    const data = JSON.parse(textOf(r));
    expect(data.entry.id).toBe("HAUS1");
  });

  it("returns a tool error (not a crash) for unknown words", async () => {
    const r = await client.callTool({ name: "lod_get_entry", arguments: { id_or_word: "Blubberwupp" } });
    expect(r.isError).toBe(true);
  });

  it("lod_get_inflection", async () => {
    const r = await client.callTool({ name: "lod_get_inflection", arguments: { id_or_word: "SCHEIN1" } });
    expect(textOf(r)).toContain("am schéinsten");
  });

  it("lb_spellcheck with n-rule", async () => {
    const r = await client.callTool({ name: "lb_spellcheck", arguments: { text: "Ech wunnen zu Lezebuerg. Den Mann drénkt Kaffi a Uebst." } });
    const t = textOf(r);
    expect(t).toContain("**Lezebuerg**");
    expect(t).toContain("**Den** Mann → **De** Mann");
    expect(t).toContain("**a** Uebst → **an** Uebst");
  }, 30_000);

  it("corpus_search", async () => {
    const r = await client.callTool({ name: "corpus_search", arguments: { query: "Gesetz", lang: "lb" } });
    const t = textOf(r);
    expect(t).toContain("LB: D'Regierung huet en neit **Gesetz** virgeluecht.");
    expect(t).toContain("FR: Le gouvernement a présenté une nouvelle loi.");
  });

  it("serves the about resource and proofreading prompt", async () => {
    const res = await client.readResource({ uri: "zls://about" });
    expect((res.contents[0] as any).text).toContain("CC0");
    const p = await client.getPrompt({ name: "proofread_luxembourgish", arguments: { text: "Moien" } });
    expect((p.messages[0].content as any).text).toContain("lb_check_draft");
  });
});
