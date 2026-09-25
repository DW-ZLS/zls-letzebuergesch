import { describe, expect, it } from "vitest";
import { checkGrammar } from "../src/grammar/checks.js";
import { LodLexicon, type Gender, type Lexicon } from "../src/grammar/lexicon.js";
import { germanisms, grammarNotes, parseGermanisms } from "../src/grammar/resources.js";
import { LodClient } from "../src/lod/client.js";
import { findSimilar, terms } from "../src/corpus/similar.js";
import { parseTmx, type Corpus } from "../src/corpus/loader.js";
import { fakeLod, fixture } from "./helpers.js";

/** Facts checked against live LOD on 2026-09-25. */
const NOUNS: Record<string, [lemma: string, g: Gender, isLemma: boolean]> = {
  Stad: ["Stad", "F", true], Frënn: ["Frënd", "M", false], Frënd: ["Frënd", "M", true], Kaffi: ["Kaffi", "M", true],
  Zäit: ["Zäit", "F", true], Auto: ["Auto", "M", true], Haus: ["Haus", "N", true], Mamm: ["Mamm", "F", true],
  Kanner: ["Kand", "N", false], Kand: ["Kand", "N", true], Loscht: ["Loscht", "F", true], Fra: ["Fra", "F", true], Leit: ["Leit", "M", false],
};
const PARTS: Record<string, "hunn" | "sinn"> = { gaangen: "sinn", komm: "sinn", bliwwen: "sinn", gefuer: "sinn", gedronk: "hunn", gehat: "hunn", gemaach: "hunn", gebaut: "hunn", ginn: "sinn" };

const fake = (): Lexicon & { calls: number } => {
  const lx = {
    calls: 0,
    async noun(w: string) {
      lx.calls++;
      const n = NOUNS[w];
      return n ? { lemma: n[0], gender: n[1], isLemma: n[2] } : null;
    },
    async participle(w: string) {
      lx.calls++;
      return PARTS[w] ? { lemma: w, aux: PARTS[w] } : null;
    },
    async fromGerman(w: string) {
      lx.calls++;
      return w === "Wetter" ? [{ lemma: "Wieder", pos: "noun (neuter)", sense: "Wetter [Wetterlage]" }] : [];
    },
  };
  return lx;
};

const run = async (text: string, unknown: string[] = []) => {
  const unknownWords = unknown.map((w) => ({ word: w, start: text.indexOf(w), end: text.indexOf(w) + w.length }));
  return (await checkGrammar(text, { lexicon: fake(), unknownWords })).map((i) => `${i.kind}:${i.text}→${i.suggestion}:${i.confidence}`);
};

describe("resources", () => {
  it("loads the editable grammar notes and Germanism list", () => {
    expect(grammarNotes()).toContain("Writing Luxembourgish");
    expect(grammarNotes()).not.toContain("<!--");
    expect(germanisms().get("wetter")?.lb).toBe("Wieder");
    expect(parseGermanisms("# c\nfoo\tbar\tnote\nbad line\n").get("foo")).toEqual({ german: "foo", lb: "bar", note: "note" });
  });
});

describe("Germanisms", () => {
  it("uses the curated list first, keeps elisions, and falls back to LOD", async () => {
    const r = await run("Dat war sehr schéin, awer d'Wetter war schlecht.", ["sehr", "d'Wetter"]);
    expect(r).toContain("germanism:sehr→ganz, immens, vill:high");
    expect(r).toContain("germanism:d'Wetter→d'Wieder:high");
  });
  it("asks for a lookup for unknown German-looking participles", async () => {
    const r = await run("mir hunn en Kaffi getrunkt", ["getrunkt"]);
    expect(r.some((x) => x.startsWith("germanism:getrunkt→(look up)"))).toBe(true);
  });
});

describe("auxiliary hunn/sinn", () => {
  it("flags hunn with a sinn-verb, using the n-rule for the suggestion", async () => {
    expect(await run("Ech hunn gëschter an d'Stad gaangen.")).toContain("auxiliary:hunn→si:high");
    expect(await run("Mir hunn eis doheem bliwwen.")).toContain("auxiliary:hunn→sinn:high");
    expect(await run("Hien huet op Paräis gefuer.")).toContain("auxiliary:huet→ass:high");
  });
  it("accepts correct perfects and passives", async () => {
    expect(await run("Mir si gëschter an d'Stad gaangen an hunn e Kaffi gedronk.")).toEqual([]);
    expect(await run("D'Haus ass gebaut ginn.")).toEqual([]);
  });
  it("handles subordinate clauses with the auxiliary at the end", async () => {
    expect(await run("Ech weess, datt hien gaangen huet.")).toContain("auxiliary:huet→ass:high");
  });
  it("marks sinn + hunn-verb only as low confidence (state passive is possible)", async () => {
    expect(await run("Hien ass e Kaffi gedronk.")).toContain("auxiliary:ass→huet:low");
  });
});

describe("articles and gender", () => {
  it("catches masculine articles on feminine/neuter nouns", async () => {
    expect(await run("Mir ginn an de Stad.")).toContain("gender:de→d'Stad:high");
    expect(await run("Ech hunn den Haus gesinn.")).toContain("gender:den→d'Haus:high");
  });
  it("catches d' on masculine nouns and uses the n-rule", async () => {
    expect(await run("D'Kaffi ass waarm.")).toContain("gender:D'Kaffi→De Kaffi:high");
    expect(await run("Ech hunn d'Auto gesinn.")).toContain("gender:d'Auto→den Auto:high");
  });
  it("checks indefinite articles", async () => {
    expect(await run("Ech hunn eng Kaffi gedronk.")).toContain("gender:eng→e:high");
    expect(await run("Ech hunn e Zäit.")).toContain("gender:e→eng:high");
  });
  it("leaves plurals and correct forms alone", async () => {
    expect(await run("D'Kanner an d'Leit sinn am Haus, den Auto an d'Stad och.")).toEqual([]);
  });
  it("does not mistake the pronoun de (du) for an article", async () => {
    expect(await run("Wann s de Loscht hues, komm.")).toEqual([]);
  });
});

describe("dative after prepositions", () => {
  it("flags nominative forms after mat/vun/bei …", async () => {
    expect(await run("Ech war mat meng Frënn do.")).toContain("case:mat meng→mat menge:high");
    expect(await run("Ech kommen vun d'Stad.")).toContain("case:vun d'Stad→vun der Stad:high");
    expect(await run("Ech fueren mat d'Auto.")).toContain("case:mat d'Auto→mam Auto:high");
    expect(await run("Ech spillen mat d'Kanner.")).toContain("case:mat d'Kanner→mat de Kanner:high");
    expect(await run("Ech schwätze mat eng Fra.")).toContain("case:mat eng→mat enger:high");
  });
  it("accepts correct datives and contractions", async () => {
    expect(await run("Ech war mat menge Frënn a mat der Mamm am Haus, mam Auto.")).toEqual([]);
  });
  it("suggests contraction for mat dem", async () => {
    expect(await run("Ech fueren mat dem Auto.")).toContain("contraction:mat dem→mam Auto:low");
  });
});

describe("LodLexicon against LOD fixtures", () => {
  it("resolves nouns and verbs from the API shapes", async () => {
    const lex = new LodLexicon(new LodClient(fakeLod().fetch, "https://lod.test/api/lb"));
    expect(await lex.noun("Haus")).toEqual({ lemma: "Haus", gender: "N", isLemma: true });
    expect(await lex.fromGerman("house")).toEqual([]); // German search route not in fixtures → nothing
  });
});

describe("similar sentences", () => {
  const corpus: Corpus = { segments: parseTmx(fixture("corpus_sample.tmx")), source: "t", files: [], counts: { lb: 4, fr: 3, de: 3, en: 2 } };
  it("tokenises with prefixes and drops stop words", () => {
    expect(terms("Die Regierung hat ein neues Gesetz vorgelegt.")).toEqual(["regierung", "regie*", "hat", "neues", "gesetz", "gesetz*".slice(0, 6) === "gesetz" ? "geset*" : "", "vorgelegt", "vorge*"].filter(Boolean));
  });
  it("finds the closest segment from another language", () => {
    const hits = findSimilar(corpus, "Le gouvernement présente une loi sur le logement.", "fr", 2);
    expect(hits[0].segment.text.lb).toBe("D'Regierung huet en neit Gesetz virgeluecht.");
  });
});
