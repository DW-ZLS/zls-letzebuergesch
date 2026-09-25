import { describe, expect, it } from "vitest";
import { LodClient } from "../src/lod/client.js";
import { formatEntry, formatInflection, formatSearch } from "../src/lod/format.js";
import { normalizeTranslations, partsToText, posLabel } from "../src/lod/normalize.js";
import { fakeLod } from "./helpers.js";

const ALL = ["de", "fr", "en", "pt"] as const;

describe("normalisation", () => {
  it("labels parts of speech and gender", () => {
    expect(posLabel("SUBST+N")).toBe("noun (neuter)");
    expect(posLabel("SUBST+F")).toBe("noun (feminine)");
    expect(posLabel("VRB")).toBe("verb");
    expect(posLabel("XYZ")).toBe("XYZ");
  });

  it("attaches clarifiers to the preceding translation", () => {
    const t = normalizeTranslations([
      { type: "translation", content: "to do" },
      { type: "semanticClarifier", content: "an activity" },
      { type: "translation", content: "to make" },
    ]);
    expect(t).toEqual([{ text: "to do", clarifier: "an activity" }, { text: "to make" }]);
  });

  it("joins elisions and punctuation in examples", () => {
    expect(
      partsToText([
        { type: "word", content: "d'" },
        { type: "word", content: "Kanner", joinWithPreviousWord: true },
        { type: "word", content: "gi" },
        { type: "word", content: "!", joinWithPreviousWord: true },
      ]),
    ).toBe("d'Kanner gi!");
  });
});

describe("LodClient + formatting", () => {
  it("searches Luxembourgish and flags matched inflected forms", async () => {
    const { fetch, calls } = fakeLod();
    const lod = new LodClient(fetch, "https://lod.test/api/lb");
    const hits = await lod.search("mécht");
    expect(hits[0]).toMatchObject({ id: "MAACHEN1", lemma: "maachen", matchedForms: ["mécht"] });
    await lod.search("mécht"); // cached
    expect(calls).toHaveLength(1);
    expect(formatSearch("mécht", "lb", hits, 10)).toContain("matched form: mécht");
  });

  it("reverse-searches from English with sense labels", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const out = formatSearch("house", "en", await lod.search("house", "en"), 10);
    expect(out).toContain("**Haus** — noun (neuter) — id `HAUS1`");
    expect(out).toContain("house [household, family]");
  });

  it("renders a full entry", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const e = await lod.entry("haus1");
    expect(e).not.toBeNull();
    const md = formatEntry(e!, { languages: [...ALL], includeExamples: true, maxExamples: 5 });
    expect(md).toContain("# Haus");
    expect(md).toContain("IPA: /hæ:ʊas/");
    expect(md).toContain("EN: house [building]");
    expect(md).toContain("FR: maison [habitation]");
    expect(md).toContain("d'Kanner gi vun **Haus** zu **Haus** liichten");
    expect(md).toContain("[EGS] dee Boxer ass e Mann ewéi en **Haus**! — *dee Boxer ass e groussen, kräftege Mann*");
    expect(md).toContain("an d'**Haiser**");
    expect(md).toContain("https://lod.lu/artikel/HAUS1");
  });

  it("resolves an inflected word to its entry", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const r = await lod.resolve("mécht");
    expect(r.entry?.id).toBe("MAACHEN1");
    expect(r.entry?.nRuleForm).toBe("maache");
    expect(r.entry?.synonyms[0].synonyms).toContain("maach der keng Suergen");
    expect(r.entry?.seeAlso.map((s) => s.id)).toEqual(["AMAACHEN1", "AUSMAACHEN1"]);
  });

  it("returns null for unknown ids and rejects malformed ids", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    expect(await lod.entry("NOPE1")).toBeNull();
    await expect(lod.entry("../etc/passwd")).rejects.toThrow(/not a valid LOD article ID/);
  });

  it("formats verb conjugation tables", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const md = formatInflection((await lod.entry("MAACHEN1"))!);
    expect(md).toContain("auxiliary: hunn");
    expect(md).toContain("| du | méchs (dech) | mouchs (dech) |");
    expect(md).toContain("periphrastic (géif/géing + inf.)");
    expect(md).toContain("### Imperative");
    expect(md).toContain("n-rule (Eifeler Regel) form: **maache**");
  });

  it("formats adjective declension tables", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const md = formatInflection((await lod.entry("SCHEIN1"))!);
    expect(md).toContain("comparative: **méi schéin**");
    expect(md).toContain("| nominative | schéinen | schéin | schéint | schéin |");
  });

  it("falls back to listed forms for nouns", async () => {
    const lod = new LodClient(fakeLod().fetch, "https://lod.test/api/lb");
    const md = formatInflection((await lod.entry("HAUS1"))!);
    expect(md).toContain("Haiser");
  });
});
