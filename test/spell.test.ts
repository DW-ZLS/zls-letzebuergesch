import { beforeAll, describe, expect, it } from "vitest";
import { checkNRule, contextOf } from "../src/spell/nrule.js";
import { getSpeller, isCorrect, spellcheck } from "../src/spell/speller.js";
import { tokenize } from "../src/spell/tokenize.js";

type Sp = Awaited<ReturnType<typeof getSpeller>>;
let sp: Sp;
beforeAll(async () => {
  sp = await getSpeller();
}, 30_000);

const opts = { maxSuggestions: 5, ignore: new Set<string>(), skipAcronyms: true, skipCapitalized: false };

describe("spellcheck", () => {
  it("accepts correct Luxembourgish incl. elisions and clitics", async () => {
    const { issues, wordCount } = await spellcheck("D'Kanner ginn haut an d'Schoul. Mir maachen dat zu Lëtzebuerg, 't ass schéin.", opts);
    expect(issues).toEqual([]);
    expect(wordCount).toBeGreaterThan(10);
  });

  it("flags misspellings with case-matched suggestions", async () => {
    const { issues } = await spellcheck("Ech wunnen zu Lezebuerg an ech hunn eng Arbecht.", opts);
    const words = issues.map((i) => i.word);
    expect(words).toEqual(["Lezebuerg", "Arbecht"]);
    expect(issues[0].suggestions).toContain("Lëtzebuerg");
    expect(issues[1].suggestions.every((s) => s === s[0] + s.slice(1).toLowerCase() || s[0] === s[0].toUpperCase())).toBe(true);
  });

  it("keeps the elision prefix in suggestions", async () => {
    const { issues } = await spellcheck("d'Schoull", opts);
    expect(issues[0].suggestions[0]).toMatch(/^d'Schoul/);
  });

  it("honours ignore list and skips acronyms", async () => {
    const { issues } = await spellcheck("De ZLS an d'Firma Blubbix.", { ...opts, ignore: new Set(["blubbix"]) });
    expect(issues).toEqual([]);
  });

  it("accepts hyphenated compounds of valid words", () => {
    expect(isCorrect(sp, "Bus-Chauffeur")).toBe(true);
  });
});

describe("tokenizer", () => {
  it("keeps elisions and hyphens inside words", () => {
    const words = tokenize("d'Kanner, z'Lëtzebuerg a Bus-Arrêt ’t").filter((t) => t.type === "word").map((t) => t.text);
    expect(words).toEqual(["d'Kanner", "z'Lëtzebuerg", "a", "Bus-Arrêt", "’t"]);
  });
});

describe("n-rule", () => {
  const deps = () => ({ isWord: (w: string) => isCorrect(sp, w) });
  const hint = async (s: string) => (await checkNRule(s, deps())).map((i) => `${i.word}→${i.suggestion}:${i.confidence}`);

  it("classifies the following sound", () => {
    const [n] = tokenize("Apel");
    expect(contextOf(n)).toBe("keep");
    expect(contextOf(tokenize("Mann")[0])).toBe("drop");
    expect(contextOf(tokenize("Hond")[0])).toBe("keep");
    expect(contextOf(tokenize("d'Kanner")[0])).toBe("keep");
    expect(contextOf(tokenize("2")[0])).toBe("unknown");
    expect(contextOf(undefined)).toBe("keep");
  });

  it("drops n before other consonants", async () => {
    expect(await hint("den Mann")).toEqual(["den→de:high"]);
    expect(await hint("Den Mann")).toEqual(["Den→De:high"]);
    expect(await hint("mir maachen Kaffi")).toEqual(["maachen→maache:medium"]);
  });

  it("keeps n before vowels and n, d, t, z, h", async () => {
    expect(await hint("den Apel, den Hond, den Direkter, mir maachen dat, en Zuch")).toEqual([]);
    expect(await hint("de Apel")).toEqual(["de→den:medium"]);
    expect(await hint("Kaffi a Uebst")).toEqual(["a→an:high"]);
    expect(await hint("wa ech kommen")).toEqual(["wa→wann:high"]);
  });

  it("does not treat the pronoun si as n-less sinn", async () => {
    expect(await hint("si ass midd")).toEqual([]);
  });

  it("uses LOD to confirm or reject uncertain cases", async () => {
    const lookups: string[] = [];
    const lod = async (w: string) => {
      lookups.push(w);
      return w.toLowerCase() === "kichen" ? "Kiche" : w.toLowerCase() === "mann" ? null : undefined;
    };
    const issues = await checkNRule("de Mann kacht an der Kichen gären", { ...deps(), lodNRuleForm: lod });
    expect(issues.map((i) => `${i.word}→${i.suggestion}:${i.confidence}`)).toEqual(["Kichen→Kiche:high"]);
    expect(issues[0].lodConfirmed).toBe(true);
    expect(lookups).toContain("Mann"); // looked up, LOD says no n-rule form → no hint
  });

  it("respects the LOD lookup budget", async () => {
    let n = 0;
    await checkNRule("Mann gesinn Mann gesinn Mann gesinn", { ...deps(), lodNRuleForm: async () => (n++, undefined), lodBudget: 2 });
    expect(n).toBe(2);
  });
});
