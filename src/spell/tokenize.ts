export type TokenType = "word" | "number" | "punct" | "space";

export interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
}

// A "word" may contain internal apostrophes and hyphens (d'Kanner, Bus-Arrêt, z'Lëtzebuerg)
// and may start with an apostrophe for the clitics 't and 's.
const TOKEN_RE =
  /(?<space>\s+)|(?<number>\d+(?:[.,:]\d+)*(?:[.]|e|te|ten)?)|(?<word>['’]?[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*['’]?)|(?<punct>[^\s\p{L}\p{M}\d])/gu;

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  for (const m of input.matchAll(TOKEN_RE)) {
    const g = m.groups ?? {};
    const type: TokenType = g.space ? "space" : g.number ? "number" : g.word ? "word" : "punct";
    out.push({ type, text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Normalise typographic apostrophes so dictionary lookups work. */
export const normApostrophe = (s: string) => s.replace(/’/g, "'");

/**
 * Luxembourgish elision prefixes: d'Kanner, z'Lëtzebuerg. Returns [prefix, rest].
 * "d'" before a word is the definite article; the rest is what we spell-check.
 */
export function splitElision(word: string): [string, string] {
  const w = normApostrophe(word);
  const m = /^([dDzZ]')(.+)$/.exec(w);
  return m ? [m[1], m[2]] : ["", w];
}

/** Characters that mark a pause (end of clause/sentence) for the n-rule. */
export const PAUSE_PUNCT = new Set([".", ",", ";", ":", "!", "?", "…", ")", "(", "»", "«", '"', "“", "”", "–", "—"]);
