import type { Corpus, CorpusLang, Segment } from "./loader.js";

export interface CorpusQuery {
  query: string;
  lang: CorpusLang;
  match: "word" | "substring";
  caseSensitive: boolean;
  ignoreAccents: boolean;
  limit: number;
  offset: number;
}

export interface CorpusHit {
  segment: Segment;
  /** [start, end) ranges of the match in the searched-language text */
  ranges: Array<[number, number]>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strip combining marks but keep a 1:1 character mapping so match offsets stay valid. */
const foldChar = (ch: string) => ch.normalize("NFD").replace(/\p{M}+/gu, "") || ch;
const fold = (s: string) => Array.from(s, foldChar).join("");

export function buildMatcher(q: CorpusQuery): RegExp {
  let pattern = q.query.trim().normalize("NFC");
  if (q.ignoreAccents) pattern = fold(pattern);
  // allow ' and ’ interchangeably, and flexible whitespace
  const body = escapeRe(pattern).replace(/['’]/g, "['’]").replace(/\s+/g, "\\s+");
  const src = q.match === "word" ? `(?<![\\p{L}\\p{M}\\d])${body}(?![\\p{L}\\p{M}\\d])` : body;
  return new RegExp(src, q.caseSensitive ? "gu" : "giu");
}

export function searchCorpus(corpus: Corpus, q: CorpusQuery): { total: number; hits: CorpusHit[] } {
  const re = buildMatcher(q);
  const all: CorpusHit[] = [];
  for (const seg of corpus.segments) {
    const raw = seg.text[q.lang];
    if (!raw) continue;
    const hay = q.ignoreAccents ? fold(raw.normalize("NFC")) : raw.normalize("NFC");
    re.lastIndex = 0;
    const ranges: Array<[number, number]> = [];
    for (const m of hay.matchAll(re)) {
      ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
      if (ranges.length > 20) break;
    }
    if (ranges.length) all.push({ segment: seg, ranges });
  }
  // Prefer compact, readable segments: they make the best usage examples.
  all.sort((a, b) => (a.segment.text[q.lang]!.length - b.segment.text[q.lang]!.length) || a.segment.id - b.segment.id);
  return { total: all.length, hits: all.slice(q.offset, q.offset + q.limit) };
}

export function highlight(text: string, ranges: Array<[number, number]>): string {
  // ranges are UTF-16 offsets into the NFC-normalised text (accent folding preserves length)
  const s = text.normalize("NFC");
  let out = "";
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    out += s.slice(pos, a) + "**" + s.slice(a, b) + "**";
    pos = b;
  }
  return out + s.slice(pos);
}
