/**
 * The official orthography as a regression suite:
 *  - every correct example from "D'Lëtzebuerger Orthografie" must pass the checkers
 *    (no high-confidence findings; a small budget for medium ones),
 *  - constructed errors derived from the rules must be caught, with the right §.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { checkOrthography } from "../src/ortho/checks.js";
import { formatSection, getSection, searchRules, sectionsForWord } from "../src/ortho/rules.js";
import { checkNRule, numberKeepsN, wordContext } from "../src/spell/nrule.js";
import { getSpeller, isCorrect } from "../src/spell/speller.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const snippets = fs
  .readFileSync(path.join(root, "resources/orthografie/beispillsnippets.tsv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => l.split("\t"))
  .filter(([s, , pol]) => pol === "pos")
  // metalinguistic fragments (single letters, "e(n)", "de_ Ball", suffixes) are not running text
  .filter(([s]) => !/_|\(\w*\)|^\S{1,2}$|^(\S{1,3}, )+\S{1,3}$|^-|-$/.test(s));

let isWord: (w: string) => boolean;
beforeAll(async () => {
  const sp = await getSpeller();
  isWord = (w) => isCorrect(sp, w);
}, 30_000);

describe("official examples are accepted", () => {
  it(`n-rule: no high-confidence findings on ${snippets.length} correct snippets`, async () => {
    const counts = { high: 0, medium: 0, low: 0 };
    const high: string[] = [];
    for (const [s] of snippets) {
      for (const i of await checkNRule(s, { isWord, endIsPause: false })) {
        counts[i.confidence]++;
        if (i.confidence === "high") high.push(`${i.word} ${i.nextWord} | ${s}`);
      }
    }
    // the only accepted high-confidence case is the letter-name example "den sch" (read Ess-Zee-Ha)
    expect(high.filter((h) => !h.startsWith("den sch"))).toEqual([]);
    expect(counts.medium).toBeLessThanOrEqual(3);
  }, 60_000);

  it("orthography checks: no high-confidence findings on the correct snippets", () => {
    const high: string[] = [];
    for (const [s] of snippets) for (const i of checkOrthography(s)) if (i.confidence === "high" && i.check !== "eszett") high.push(`${i.check}: ${i.text} | ${s}`);
    expect(high).toEqual([]);
  });
});

describe("n-rule details from §6", () => {
  it("reads numbers as spoken (§6.1.1)", () => {
    expect(numberKeepsN("1.")).toBe(true); // den 1. Abrëll
    expect(numberKeepsN("5.")).toBe(false); // de 5. Abrëll
    expect(numberKeepsN("8")).toBe(true); // aacht
    expect(numberKeepsN("14")).toBe(false); // véierzéng
    expect(numberKeepsN("21")).toBe(true); // eenanzwanzeg
    expect(numberKeepsN("100")).toBe(true); // honnert
    expect(numberKeepsN("400")).toBe(false); // véierhonnert
  });
  it("reads letters, acronyms and loanwords by pronunciation (§6.1.1)", () => {
    expect(wordContext("LCTO-Programm").ctx).toBe("keep"); // Ell
    expect(wordContext("BMW").ctx).toBe("drop"); // Bee
    expect(wordContext("Job").ctx).toBe("keep"); // [dʒ]
    expect(wordContext("Journal").ctx).toBe("drop"); // [ʒ]
    expect(wordContext("Chartervol").ctx).toBe("keep"); // [tʃ]
    expect(wordContext("Chef").ctx).toBe("drop"); // [ʃ]
    expect(wordContext("Centime").ctx).toBe("optional");
    expect(wordContext("si").ctx).toBe("optional"); // §6.2.1
  });

  const flag = async (s: string) => (await checkNRule(s, { isWord })).map((i) => `${i.word}→${i.suggestion}:${i.confidence}:§${i.rule}`);

  it("catches errors in constructed sentences", async () => {
    expect(await flag("den Ball")).toEqual(["den→de:high:§6.1.1"]);
    expect(await flag("den 5. Abrëll")).toEqual(["den→de:high:§6.1.1"]);
    expect(await flag("den Journal")).toEqual(["den→de:high:§6.1.1"]);
    expect(await flag("eng schéin Geschicht")).toEqual(["schéin→schéi:high:§6.1.1"]);
    expect(await flag("Ech hu.")).toEqual(["hu→hunn:high:§6.1.2.4"]);
    expect(await flag("en Zwee-Phasen-Modell")).toEqual(["Phasen→Phase:medium:§6.1.2.5"]);
  });
  it("respects optional and exempt cases", async () => {
    expect(await flag("de Wäin gëtt gedronk, e Wäi schmaacht")).toEqual([]); // -äin optional (§6.1.2.2)
    expect(await flag("e Steen geheien")).toEqual([]); // one-syllable -een noun optional
    expect(await flag("Frënn gesinn, eng ronn Saach")).toEqual([]); // nouns/adjectives keep n
    expect(await flag("hunn si, vun senger Plaz")).toEqual([]); // §6.2.1
    expect(await flag("Ech freeë mech, och wann s de näischt matbréngs.")).toEqual([]); // linking s
    expect(await flag("zu Wien raschten")).toEqual([]); // name (§6.3/6.4)
    expect(await flag("Ech verkafen en (kaum benotzten) Computer.")).toEqual([]); // §6.1.2.4
  });
});

describe("orthography checks", () => {
  const c = (s: string) => checkOrthography(s).map((i) => `${i.check}:${i.suggestion}:§${i.rule}`);
  it("finds rule violations with the right §", () => {
    expect(c("Wéi geet et ?")).toEqual(["punct-space:?:§10.2.3"]);
    expect(c("Dat ass z.B. gutt.")).toEqual(["abbreviation:z. B.:§8.5.1"]);
    expect(c("Et sinn 10% méi.")).toEqual(["unit-space:10 %:§8.5.1"]);
    expect(c("Mir gesinn eis de méindeg.")).toEqual(["capitalisation:Méindeg:§8.3"]);
    expect(c("Mir gi Sonndes spadséieren.")).toEqual(["capitalisation:sonndes:§8.3"]);
    expect(c("gëschter mueren")).toEqual(["capitalisation:Mueren:§8.3"]);
    expect(c("hie mëcht dat")).toEqual(["e-accent:mécht:§2.2.3"]);
    expect(c("eng grouße Strooße")).toEqual(["eszett:grousse:§4.3.4.2", "eszett:Stroosse:§4.3.4.2"]);
    expect(c("Wanns de wëlls")).toEqual(["linking-s:Wann s de:§4.4.1"]);
    expect(c("Ech mengen datt et reent.")).toEqual(["comma:mengen, datt:§10.3.1.3"]);
    expect(c("Hien huet gesot - dat stëmmt.")).toEqual(["dash: – :§10.3.5"]);
  });
  it("accepts correct text", () => {
    expect(c("Ech mengen, datt et reent. Mir gi sonndes moies spadséieren, z. B. mat 10 % manner. Wéi geet et? Egal ob et reent.")).toEqual([]);
  });
});

describe("rule lookup", () => {
  it("returns paragraphs by §, topic and example word", () => {
    expect(getSection("6.2.1")?.title).toMatch(/si, se/);
    expect(formatSection(getSection("6.1.2.4")!)).toContain("Viru Sazzeeche bleift den *n* ëmmer stoen");
    expect(searchRules("Komma virun datt", 1)[0].section.id).toBe("10.3.1.3");
    expect(searchRules("capital letters days of the week", 1)[0].section.id).toBe("8.3");
    expect(sectionsForWord("Wäin").map((s) => s.id)).toContain("6.1.2.2");
  });
});
