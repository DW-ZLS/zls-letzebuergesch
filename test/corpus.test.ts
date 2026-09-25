import fs from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { normLang, parseBuffer, parseJsonl, parseTmx, type Corpus } from "../src/corpus/loader.js";
import { highlight, searchCorpus } from "../src/corpus/search.js";
import { fixture, fixturePath } from "./helpers.js";

describe("language codes", () => {
  it.each([
    ["lb-LU", "lb"], ["LU", "lb"], ["ltz", "lb"], ["LB", "lb"], ["text_lb", "lb"], ["fr-FR", "fr"], ["fra", "fr"],
    ["de_DE", "de"], ["en-GB", "en"], ["Luxembourgish", "lb"], ["xx", undefined],
  ])("%s → %s", (code, want) => expect(normLang(code)).toBe(want));
});

describe("TMX", () => {
  const segs = parseTmx(fixture("corpus_sample.tmx"));
  it("reads all translation units and languages", () => {
    expect(segs).toHaveLength(4);
    expect(segs[0].text).toEqual({
      lb: "D'Regierung huet en neit Gesetz virgeluecht.",
      fr: "Le gouvernement a présenté une nouvelle loi.",
      de: "Die Regierung hat ein neues Gesetz vorgelegt.",
      en: "The government has presented a new law.",
    });
    expect(segs[0].meta).toMatchObject({ "x-domain": "news", tuid: "1" });
  });
  it("strips inline tags and decodes entities", () => {
    expect(segs[1].text.lb).toBe("Mir maachen haut e schéint Fest & mir invitéieren d'Noperen.");
  });
});

describe("JSONL", () => {
  it("understands flat, nested and source/target layouts", () => {
    const segs = parseJsonl(fixture("corpus_flat.jsonl"));
    expect(segs.map((s) => s.text)).toEqual([
      { lb: "Moien, wéi geet et?", fr: "Bonjour, comment ça va ?", de: "Hallo, wie geht es?", en: "Hello, how are you?" },
      { lb: "Merci villmools.", de: "Vielen Dank." },
      { lb: "Äddi!", fr: "Au revoir !" },
      { lb: "Ech schwätze Lëtzebuergesch.", en: "I speak Luxembourgish." },
    ]);
  });
});

describe("ZIP", () => {
  it("prefers TMX over other formats inside the published zip", () => {
    const zip = zipSync({
      "LU-FR-DE-EN/corpus.tmx": fs.readFileSync(fixturePath("corpus_sample.tmx")),
      "LU-FR-DE-EN/corpus.jsonl": strToU8(fixture("corpus_flat.jsonl")),
      "LU-FR-DE-EN/corpus.xlsx": strToU8("binary"),
    });
    const { segments, files } = parseBuffer("lu-fr-de-en.zip", zip);
    expect(files).toEqual(["lu-fr-de-en.zip:LU-FR-DE-EN/corpus.tmx"]);
    expect(segments).toHaveLength(4);
  });
});

describe("search", () => {
  const segments = parseTmx(fixture("corpus_sample.tmx"));
  const corpus: Corpus = { segments, source: "test", files: [], counts: { lb: 4, fr: 3, de: 3, en: 2 } };
  const q = { lang: "lb" as const, match: "word" as const, caseSensitive: false, ignoreAccents: false, limit: 10, offset: 0 };

  it("matches whole words by default", () => {
    expect(searchCorpus(corpus, { ...q, query: "Haus" }).total).toBe(1); // not Gemengenhaus
    expect(searchCorpus(corpus, { ...q, query: "haus", match: "substring" }).total).toBe(2);
  });
  it("searches other languages", () => {
    const r = searchCorpus(corpus, { ...q, lang: "fr", query: "maison" });
    expect(r.hits[0].segment.text.lb).toBe("D'Haus ass al.");
  });
  it("handles apostrophe variants and accents", () => {
    expect(searchCorpus(corpus, { ...q, query: "d’Noperen" }).total).toBe(1);
    expect(searchCorpus(corpus, { ...q, query: "scheint" }).total).toBe(0);
    expect(searchCorpus(corpus, { ...q, query: "scheint", ignoreAccents: true }).total).toBe(1);
  });
  it("highlights matches", () => {
    const r = searchCorpus(corpus, { ...q, query: "Gesetz" });
    expect(highlight(r.hits[0].segment.text.lb!, r.hits[0].ranges)).toBe("D'Regierung huet en neit **Gesetz** virgeluecht.");
  });
});
