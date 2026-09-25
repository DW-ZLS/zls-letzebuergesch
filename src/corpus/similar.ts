/**
 * "Translation-memory" style retrieval: find the corpus segments most similar
 * to a given sentence (BM25 over word tokens + 5-letter prefixes, which
 * approximates stemming for Luxembourgish/German/French inflection).
 */
import type { Corpus, CorpusLang, Segment } from "./loader.js";

const TOKEN_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

// Very frequent function words carry no signal; BM25's IDF already damps them, this just saves work.
const STOP = new Set([
  // lb
  "an", "a", "de", "den", "d'", "dem", "der", "e", "en", "eng", "et", "ass", "sinn", "si", "vun", "vu", "fir", "mat", "op", "um", "am", "datt", "ze", "och", "net", "sech", "hien", "hie", "mir", "mer", "ech", "du", "dat", "déi", "dee", "wéi", "ginn", "gëtt", "hunn", "huet",
  // de
  "und", "die", "der", "das", "den", "dem", "des", "ein", "eine", "ist", "sind", "zu", "mit", "von", "für", "auf", "im", "in", "nicht", "sich", "es", "er", "sie", "wir", "ich", "dass", "wird", "werden",
  // fr
  "le", "la", "les", "l'", "un", "une", "des", "du", "de", "et", "est", "sont", "à", "au", "aux", "en", "pour", "par", "sur", "dans", "que", "qui", "ne", "pas", "se", "il", "elle", "nous", "je",
  // en
  "the", "a", "an", "and", "is", "are", "to", "of", "in", "on", "for", "with", "that", "it", "be", "by", "as", "at", "this", "we", "i",
]);

export function terms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize("NFC").toLocaleLowerCase().matchAll(TOKEN_RE)) {
    let w = m[0].replace(/’/g, "'");
    w = w.replace(/^[dlzcjmnst]'/, ""); // elisions: d'Haus, l'Europe
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w);
    if (w.length > 5) out.push(`${w.slice(0, 5)}*`);
  }
  return out;
}

interface Index {
  docs: Segment[];
  tf: Array<Map<string, number>>;
  len: number[];
  avgLen: number;
  df: Map<string, number>;
}

const indexes = new WeakMap<Corpus, Map<CorpusLang, Index>>();

function getIndex(corpus: Corpus, lang: CorpusLang): Index {
  let perLang = indexes.get(corpus);
  if (!perLang) indexes.set(corpus, (perLang = new Map()));
  const cached = perLang.get(lang);
  if (cached) return cached;
  const docs = corpus.segments.filter((s) => s.text[lang]);
  const tf: Index["tf"] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const t = terms(d.text[lang]!);
    const m = new Map<string, number>();
    for (const x of t) m.set(x, (m.get(x) ?? 0) + 1);
    for (const x of m.keys()) df.set(x, (df.get(x) ?? 0) + 1);
    tf.push(m);
    len.push(t.length);
  }
  const idx = { docs, tf, len, avgLen: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length), df };
  perLang.set(lang, idx);
  return idx;
}

export interface SimilarHit {
  segment: Segment;
  score: number;
}

export function findSimilar(corpus: Corpus, text: string, lang: CorpusLang, k: number, exclude = new Set<number>()): SimilarHit[] {
  const idx = getIndex(corpus, lang);
  const q = [...new Set(terms(text))];
  if (!q.length) return [];
  const N = idx.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<number, number>();
  for (const term of q) {
    const df = idx.df.get(term);
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (term.endsWith("*") ? 0.5 : 1);
    for (let i = 0; i < N; i++) {
      const f = idx.tf[i].get(term);
      if (!f) continue;
      const s = (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * idx.len[i]) / idx.avgLen));
      scores.set(i, (scores.get(i) ?? 0) + s);
    }
  }
  return [...scores.entries()]
    .filter(([i]) => !exclude.has(idx.docs[i].id))
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, k)
    .map(([i, score]) => ({ segment: idx.docs[i], score }));
}

/** Split long input into sentences so each gets its own neighbours. */
export function splitSentences(text: string, max = 6): string[] {
  const parts = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return parts.slice(0, max);
}
