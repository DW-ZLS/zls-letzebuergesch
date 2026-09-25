/**
 * Word-level facts the grammar checks need, answered from LOD.
 * Behind an interface so tests (and a future offline LOD dump) can replace it.
 */
import type { LodClient } from "../lod/client.js";

export type Gender = "M" | "F" | "N";

export interface NounInfo {
  lemma: string;
  gender: Gender | null; // null = unknown / ambiguous
  /** true when the word is exactly the headword (i.e. singular nominative form) */
  isLemma: boolean;
}

export interface ParticipleInfo {
  lemma: string;
  aux: "hunn" | "sinn" | "both";
}

export interface GermanHit {
  lemma: string;
  pos: string;
  sense: string;
}

export interface Lexicon {
  noun(word: string): Promise<NounInfo | null>;
  participle(word: string): Promise<ParticipleInfo | null>;
  /** Luxembourgish equivalents of a German word (LOD reverse search) */
  fromGerman(word: string): Promise<GermanHit[]>;
}

const genderOf = (pos: string): Gender | null => {
  const m = /^SUBST\+([MFN])$/.exec(pos);
  return m ? (m[1] as Gender) : null;
};

const lc = (s: string) => s.toLocaleLowerCase("lb");

export class LodLexicon implements Lexicon {
  constructor(private readonly lod: LodClient) {}

  async noun(word: string): Promise<NounInfo | null> {
    const hits = (await this.lod.search(word, "lb")).filter((h) => h.pos.startsWith("SUBST") && !h.erroneous);
    if (!hits.length) return null;
    const exact = hits.filter((h) => h.lemma === word);
    if (exact.length) {
      const genders = new Set(exact.map((h) => genderOf(h.pos)));
      const g = genders.size === 1 ? [...genders][0] : null;
      return { lemma: word, gender: g, isLemma: true };
    }
    const inflected = hits.filter((h) => h.matchedForms.some((f) => lc(f) === lc(word)));
    if (inflected.length === 1) return { lemma: inflected[0].lemma, gender: genderOf(inflected[0].pos), isLemma: false };
    return null;
  }

  async participle(word: string): Promise<ParticipleInfo | null> {
    const hits = (await this.lod.search(word, "lb")).filter(
      (h) => h.pos === "VRB" && !h.erroneous && h.matchedForms.some((f) => lc(f) === lc(word)),
    );
    if (!hits.length) return null;
    // prefer simple verbs over multi-word expressions (goen before "zegronn goen")
    hits.sort((a, b) => Number(a.lemma.includes(" ")) - Number(b.lemma.includes(" ")));
    const entry = await this.lod.entry(hits[0].id);
    if (!entry) return null;
    const parts = new Set<string>();
    const auxes = new Set<string>();
    for (const s of entry.sections) {
      s.pastParticiple.forEach((p) => parts.add(lc(p)));
      if (s.auxiliaryVerb) s.auxiliaryVerb.split(/[\/,]| an | oder /).forEach((a) => a.trim() && auxes.add(lc(a.trim())));
    }
    const conj = (entry.tables?.verbConjugation ?? {}) as Record<string, unknown>;
    if (typeof conj.pastParticiple === "string") conj.pastParticiple.split("/").forEach((p) => parts.add(lc(p.trim())));
    if (typeof conj.auxiliaryVerb === "string") conj.auxiliaryVerb.split("/").forEach((a) => a.trim() && auxes.add(lc(a.trim())));
    if (!parts.has(lc(word))) return null; // matched some other form of the verb
    const hasH = auxes.has("hunn");
    const hasS = auxes.has("sinn");
    if (!hasH && !hasS) return null;
    return { lemma: entry.lemma, aux: hasH && hasS ? "both" : hasH ? "hunn" : "sinn" };
  }

  async fromGerman(word: string): Promise<GermanHit[]> {
    const hits = await this.lod.search(word, "de");
    const re = new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
    const out: GermanHit[] = [];
    for (const h of hits) {
      if (h.erroneous) continue;
      const m = h.meanings.find((mm) => re.test(mm.translation)) ?? h.meanings[0];
      out.push({ lemma: h.lemma, pos: h.posLabel, sense: m?.translation ?? "" });
    }
    // single-word headwords whose sense is exactly the German word first
    out.sort((a, b) => score(b, word) - score(a, word));
    return out.slice(0, 4);
  }
}

function score(h: GermanHit, word: string): number {
  let s = 0;
  if (!h.lemma.includes(" ")) s += 2;
  if (h.sense.replace(/\s*\[.*?\]\s*/g, "").trim().toLowerCase() === word.toLowerCase()) s += 3;
  return s;
}
