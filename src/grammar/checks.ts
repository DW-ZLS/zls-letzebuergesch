/**
 * Grammar checks for typical "pseudo-Luxembourgish" (German-influenced) errors,
 * grounded in LOD data via the Lexicon interface:
 *   - Germanisms (curated list + LOD German→Luxembourgish search)
 *   - article ↔ noun gender (gender from LOD)
 *   - dative after dative-only prepositions
 *   - perfect-tense auxiliary hunn/sinn (auxiliary from LOD)
 * Every finding carries a confidence; nothing is auto-corrected.
 */
import { mapLimit } from "../lib/limit.js";
import { contextOf, type Confidence } from "../spell/nrule.js";
import { normApostrophe, tokenize, type Token } from "../spell/tokenize.js";
import type { Gender, Lexicon, NounInfo } from "./lexicon.js";
import { germanisms } from "./resources.js";

export type IssueKind = "germanism" | "gender" | "case" | "auxiliary" | "contraction";

export interface GrammarIssue {
  kind: IssueKind;
  text: string;
  start: number;
  end: number;
  suggestion: string;
  message: string;
  confidence: Confidence;
}

export interface GrammarOptions {
  lexicon: Lexicon;
  /** words the spellchecker did not recognise (for the Germanism check) */
  unknownWords?: Array<{ word: string; start: number; end: number }>;
  maxLookups?: number;
}

const GENDER_NAME: Record<Gender, string> = { M: "masculine", F: "feminine", N: "neuter" };

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

interface W {
  tok: Token;
  text: string; // apostrophe-normalised
  lower: string;
  idx: number; // index in word list
}

const lc = (s: string) => s.toLocaleLowerCase("lb");
const isCap = (s: string) => /^\p{Lu}/u.test(s);
const CLAUSE_PUNCT = /^[.,;:!?…()"“”«»–—]$/;

function words(text: string): { list: W[]; tokens: Token[]; breakAfter: Set<number> } {
  const tokens = tokenize(text);
  const list: W[] = [];
  const breakAfter = new Set<number>(); // word idx followed by clause punctuation
  for (const t of tokens) {
    if (t.type === "word") {
      const n = normApostrophe(t.text);
      list.push({ tok: t, text: n, lower: lc(n), idx: list.length });
    } else if (t.type === "punct" && CLAUSE_PUNCT.test(t.text) && list.length) {
      breakAfter.add(list.length - 1);
    }
  }
  return { list, tokens, breakAfter };
}

/** Choose n-rule variant of an article/possessive ("den"/"de") for the following word. */
function nForm(withN: string, next: string): string {
  const ctx = contextOf(tokenize(next)[0]);
  return ctx === "drop" ? withN.replace(/nn?$/, "") : withN;
}

function likeCase(model: string, s: string) {
  return isCap(model) ? s[0].toUpperCase() + s.slice(1) : s;
}

export class Budget {
  constructor(public left: number) {}
  take() {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }
}

/* ---------------------------------------------------------------- */
/* 1. Germanisms                                                     */
/* ---------------------------------------------------------------- */

export async function checkGermanisms(
  unknown: Array<{ word: string; start: number; end: number }>,
  lexicon: Lexicon,
  budget: Budget,
): Promise<GrammarIssue[]> {
  const list = germanisms();
  const out: GrammarIssue[] = [];
  const seen = new Map<string, GrammarIssue | null>();
  await mapLimit(unknown, 4, async (u) => {
    const w = normApostrophe(u.word);
    const m = /^([dDzZ]')(.+)$/.exec(w);
    const prefix = m?.[1] ?? "";
    const core = m?.[2] ?? w;
    const key = lc(core);
    let base = seen.get(key);
    if (base === undefined) {
      base = null;
      const entry = list.get(key);
      if (entry) {
        base = {
          kind: "germanism", text: u.word, start: 0, end: 0,
          suggestion: entry.lb,
          message: `German “${core}”, not Luxembourgish${entry.note ? ` (${entry.note})` : ""}`,
          confidence: "high",
        };
      } else if (core.length >= 3 && budget.take()) {
        const hits = await lexicon.fromGerman(core).catch(() => []);
        if (hits.length) {
          base = {
            kind: "germanism", text: u.word, start: 0, end: 0,
            suggestion: hits.map((h) => h.lemma).filter((v, i, a) => a.indexOf(v) === i).join(", "),
            message: `looks German; LOD translates German “${core}” as: ${hits.map((h) => `${h.lemma} (${h.pos}${h.sense ? `: ${h.sense}` : ""})`).join("; ")}`,
            confidence: "medium",
          };
        } else if (/^ge\p{Ll}+(t|en)$/u.test(core)) {
          base = {
            kind: "germanism", text: u.word, start: 0, end: 0,
            suggestion: "(look up)",
            message: "looks like a German past participle: look up the German infinitive with lod_search(lang='de'), then the Luxembourgish participle with lod_get_inflection",
            confidence: "low",
          };
        }
      }
      seen.set(key, base);
    }
    if (base) {
      const sugg = base.suggestion.startsWith("(") ? base.suggestion : base.suggestion.split(/,\s*/).map((s) => prefix + likeCase(core, s)).join(", ");
      out.push({ ...base, text: u.word, start: u.start, end: u.end, suggestion: sugg });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------- */
/* 2 + 3. Articles, gender, dative                                   */
/* ---------------------------------------------------------------- */

const DATIVE_PREPS = new Set(["mat", "vun", "vu", "bei", "zu", "no", "aus", "zënter", "zanter", "vis-à-vis"]);
const CONTRACTIONS: Record<string, string> = { mat: "mam", vun: "vum", vu: "vum", zu: "zum", bei: "beim", an: "am", a: "am", op: "um", u: "um", un: "um" };

type ArticleKind = "def" | "defDatM" | "defDatF" | "indef" | "indefF" | "indefDatM" | "indefDatF" | "elided";

const ARTICLES: Record<string, ArticleKind> = {
  den: "def", de: "def",
  dem: "defDatM", der: "defDatF",
  en: "indef", e: "indef",
  eng: "indefF",
  engem: "indefDatM", enger: "indefDatF",
};

/** nominative/accusative determiners that are wrong right after a dative-only preposition */
const NOT_DATIVE: Record<string, { m: string; f: string; pl: string }> = {
  mäin: { m: "mengem", f: "menger", pl: "mengen" },
  meng: { m: "mengem", f: "menger", pl: "mengen" },
  däin: { m: "dengem", f: "denger", pl: "dengen" },
  deng: { m: "dengem", f: "denger", pl: "dengen" },
  säin: { m: "sengem", f: "senger", pl: "sengen" },
  seng: { m: "sengem", f: "senger", pl: "sengen" },
  hiren: { m: "hirem", f: "hirer", pl: "hiren" },
  hir: { m: "hirem", f: "hirer", pl: "hiren" },
  eisen: { m: "eisem", f: "eiser", pl: "eisen" },
  eis: { m: "eisem", f: "eiser", pl: "eisen" },
  ären: { m: "ärem", f: "ärer", pl: "ären" },
  är: { m: "ärem", f: "ärer", pl: "ären" },
  eng: { m: "engem", f: "enger", pl: "–" },
  en: { m: "engem", f: "enger", pl: "–" },
  e: { m: "engem", f: "enger", pl: "–" },
  keng: { m: "kengem", f: "kenger", pl: "kengen" },
  keen: { m: "kengem", f: "kenger", pl: "kengen" },
  kee: { m: "kengem", f: "kenger", pl: "kengen" },
  déi: { m: "deem", f: "där", pl: "deenen" },
  dat: { m: "deem", f: "där", pl: "deenen" },
};

/** Find the noun an article refers to: first capitalised word within 3 words, same clause. */
function headNoun(list: W[], i: number, breakAfter: Set<number>): W | null {
  for (let j = i + 1; j <= i + 3 && j < list.length; j++) {
    if (breakAfter.has(j - 1)) return null;
    const w = list[j];
    if (ARTICLES[w.lower] || NOT_DATIVE[w.lower] || DATIVE_PREPS.has(w.lower)) return null;
    if (isCap(w.text) && !/^[dDzZ]'/.test(w.text)) return w;
    if (!/^\p{Ll}/u.test(w.text)) return null;
  }
  return null;
}

function prevWord(list: W[], i: number, breakAfter: Set<number>): W | null {
  return i > 0 && !breakAfter.has(i - 1) ? list[i - 1] : null;
}

export async function checkArticlesAndCase(text: string, lexicon: Lexicon, budget: Budget): Promise<GrammarIssue[]> {
  const { list, breakAfter } = words(text);
  const out: GrammarIssue[] = [];

  // Collect nouns to look up first (in parallel, bounded).
  type Job = { i: number; noun: W; art: string; kind: ArticleKind | "afterPrep"; prep?: W };
  const jobs: Job[] = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const prev = prevWord(list, i, breakAfter);
    // elided article: d'Stad
    const el = /^([dD])'(\p{Lu}.*)$/u.exec(w.text);
    if (el) {
      jobs.push({ i, noun: { ...w, text: el[2], lower: lc(el[2]) }, art: `${el[1]}'`, kind: prev && DATIVE_PREPS.has(prev.lower) ? "afterPrep" : "elided", prep: prev && DATIVE_PREPS.has(prev.lower) ? prev : undefined });
      continue;
    }
    const kind = ARTICLES[w.lower];
    if (kind) {
      // "wann s de …", "hues de …": unstressed pronoun de (= du), not an article
      if ((w.lower === "de" || w.lower === "e") && prev && /s$|st$/.test(prev.lower) && !DATIVE_PREPS.has(prev.lower)) continue;
      const noun = headNoun(list, i, breakAfter);
      if (noun) jobs.push({ i, noun, art: w.text, kind: prev && DATIVE_PREPS.has(prev.lower) && NOT_DATIVE[w.lower] ? "afterPrep" : kind, prep: prev && DATIVE_PREPS.has(prev.lower) ? prev : undefined });
      continue;
    }
    if (NOT_DATIVE[w.lower] && prev && DATIVE_PREPS.has(prev.lower)) {
      const noun = headNoun(list, i, breakAfter);
      jobs.push({ i, noun: noun ?? w, art: w.text, kind: "afterPrep", prep: prev });
    }
  }

  const infos = await mapLimit(jobs, 6, async (j) => {
    if (!isCap(j.noun.text) || !budget.take()) return null;
    return lexicon.noun(j.noun.text).catch(() => null);
  });

  jobs.forEach((j, k) => {
    const info: NounInfo | null = infos[k];
    const artTok = list[j.i].tok;
    const nounText = j.noun.text;
    const g = info?.gender ?? null;
    const sg = info?.isLemma ?? false;
    const push = (kind: IssueKind, suggestion: string, message: string, confidence: Confidence, start = artTok.start, end = artTok.end) =>
      out.push({ kind, text: text.slice(start, end), start, end, suggestion, message, confidence });

    if (j.kind === "afterPrep" && j.prep) {
      const prep = j.prep;
      const span = [prep.tok.start, artTok.end] as const;
      const nounLabel = info ? (sg ? `${info.lemma}${g ? `, ${GENDER_NAME[g]}` : ""}` : `${nounText}: inflected/plural form of ${info.lemma}`) : nounText;
      if (/^[dD]'/.test(j.art)) {
        let s: string;
        if (info && !sg) s = `${prep.text} ${nForm("den", nounText)} ${nounText}`;
        else if (g === "F") s = `${prep.text} der ${nounText}`;
        else if (g === "N" || g === "M") s = `${CONTRACTIONS[prep.lower] ?? `${prep.text} dem`} ${nounText}`;
        else s = `${prep.text} der/dem/de(n) ${nounText}`;
        push("case", s, `“${prep.text}” takes the dative: d' is nominative/accusative (${nounLabel})`, info ? "high" : "medium", span[0], artTok.end);
        return;
      }
      const forms = NOT_DATIVE[lc(j.art)];
      if (!forms) return;
      let s: string;
      if (info && !sg) s = forms.pl === "–" ? "(no plural)" : nForm(forms.pl, nounText);
      else if (g === "F") s = forms.f;
      else if (g === "M" || g === "N") s = forms.m;
      else s = `${forms.m} (m./n.) / ${forms.f} (f.) / ${nForm(forms.pl, nounText)} (pl.)`;
      push("case", `${prep.text} ${likeCase(j.art, s)}`, `“${prep.text}” takes the dative (${nounLabel})`, info ? "high" : "medium", span[0], artTok.end);
      return;
    }

    if (!info || !g || !sg) return; // only judge clear singular headwords with a single known gender
    const n = nounText;
    const art = lc(j.art);
    switch (j.kind) {
      case "elided":
        if (g === "M") push("gender", `${likeCase(j.art, nForm("den", n))} ${n}`, `${info.lemma} is masculine: d' is only feminine/neuter/plural`, "high", artTok.start, artTok.end);
        break;
      case "def":
        if (g !== "M") {
          if (j.prep) break; // could be dative plural "mat de(n) …"
          push("gender", `${likeCase(j.art, "d'")}${n}`, `${info.lemma} is ${GENDER_NAME[g]}: “${j.art}” is masculine`, "high");
        }
        break;
      case "defDatM":
        if (g === "F") push("gender", likeCase(j.art, "der"), `${info.lemma} is feminine: dative “der”`, "high");
        break;
      case "defDatF":
        if (g !== "F") push("gender", likeCase(j.art, "dem"), `${info.lemma} is ${GENDER_NAME[g]}: dative “dem”${j.prep && CONTRACTIONS[j.prep.lower] ? ` (usually “${CONTRACTIONS[j.prep.lower]}”)` : ""}`, "medium");
        break;
      case "indef":
        if (g === "F") push("gender", likeCase(j.art, "eng"), `${info.lemma} is feminine: “eng”`, "high");
        break;
      case "indefF":
        if (g !== "F") push("gender", likeCase(j.art, nForm("en", n)), `${info.lemma} is ${GENDER_NAME[g]}: “e(n)”`, art === "eng" ? "high" : "medium");
        break;
      case "indefDatM":
        if (g === "F") push("gender", likeCase(j.art, "enger"), `${info.lemma} is feminine: dative “enger”`, "high");
        break;
      case "indefDatF":
        if (g !== "F") push("gender", likeCase(j.art, "engem"), `${info.lemma} is ${GENDER_NAME[g]}: dative “engem”`, "high");
        break;
    }
    // contraction: "mat dem Auto" → "mam Auto"
    if (j.kind === "defDatM" && g !== "F" && j.prep && CONTRACTIONS[j.prep.lower]) {
      push("contraction", `${CONTRACTIONS[j.prep.lower]} ${n}`, `“${j.prep.text} dem” is normally contracted (unless “dem” is stressed/demonstrative)`, "low", j.prep.tok.start, artTok.end);
    }
  });
  return out;
}

/* ---------------------------------------------------------------- */
/* 4. Perfect-tense auxiliary                                        */
/* ---------------------------------------------------------------- */

const HUNN_TO_SINN: Record<string, string> = {
  hunn: "sinn", hu: "si", hues: "bass", huet: "ass", hutt: "sidd", hat: "war", has: "wars", haten: "waren",
  hätt: "wier", häss: "wiers", hätten: "wieren",
};
const SINN_TO_HUNN: Record<string, string> = {
  sinn: "hunn", bass: "hues", ass: "huet", sidd: "hutt", war: "hat", wars: "has", waren: "haten",
  wier: "hätt", wiers: "häss", wieren: "hätten",
};
const NOT_PARTICIPLES = new Set(["gären", "géint", "gëschter", "genuch", "genau", "géif", "géing", "géifen", "géingen", "gëtt", "gesond", "gelift", "gewinnt", "geschwënn", "gewëss", "bestëmmt", "vergiess", "erëm", "ëmmer", "eréischt", "besonnesch", "ënnen", "iwwer", "ënner"]);
const IRREGULAR = new Set(["komm", "fonnt", "bruecht", "bliwwen", "ginn", "gaangen", "kaf", "giess", "fort", "ukomm", "erakomm", "erauskomm", "matkomm"]);

function looksLikeParticiple(w: W): boolean {
  if (isCap(w.text) || w.lower.length < 3 || NOT_PARTICIPLES.has(w.lower)) return false;
  if (HUNN_TO_SINN[w.lower] || SINN_TO_HUNN[w.lower]) return false;
  return /ge/.test(w.lower) || /^(be|ver|ent|zer|er)\p{L}{3,}/u.test(w.lower) || /éiert$/.test(w.lower) || IRREGULAR.has(w.lower) || /komm$/.test(w.lower);
}

export async function checkAuxiliaries(text: string, lexicon: Lexicon, budget: Budget): Promise<GrammarIssue[]> {
  const { list, breakAfter } = words(text);
  const out: GrammarIssue[] = [];
  const auxIdx = list.map((w, i) => (HUNN_TO_SINN[w.lower] || SINN_TO_HUNN[w.lower] ? i : -1)).filter((i) => i >= 0);

  for (const ai of auxIdx) {
    const aux = list[ai];
    const cands: W[] = [];
    // main clause: participle after the auxiliary, up to clause end or the next auxiliary
    for (let j = ai + 1; j < list.length && !breakAfter.has(ai); j++) {
      if (HUNN_TO_SINN[list[j].lower] || SINN_TO_HUNN[list[j].lower]) break;
      if (looksLikeParticiple(list[j])) cands.push(list[j]);
      if (breakAfter.has(j)) break;
    }
    cands.reverse(); // clause-final participle first ("ass gebaut ginn" → ginn)
    // subordinate clause: participle right before a clause-final auxiliary ("datt hie gaange sinn")
    if (breakAfter.has(ai) || ai === list.length - 1) {
      for (let j = ai - 1; j >= Math.max(0, ai - 2); j--) {
        if (breakAfter.has(j)) break;
        if (looksLikeParticiple(list[j])) cands.push(list[j]);
      }
    }
    for (const c of cands.slice(0, 3)) {
      if (!budget.take()) return out;
      // n-rule forms of participles ("gaange sinn") → try with n restored
      let info = await lexicon.participle(c.text).catch(() => null);
      if (!info && /e$/.test(c.lower) && budget.take()) info = await lexicon.participle(c.text + "n").catch(() => null);
      if (!info) continue;
      const a = aux.lower;
      if (info.aux === "sinn" && HUNN_TO_SINN[a]) {
        out.push({
          kind: "auxiliary", text: aux.tok.text, start: aux.tok.start, end: aux.tok.end,
          suggestion: likeCase(aux.text, nForm(HUNN_TO_SINN[a], list[ai + 1]?.text ?? ".")),
          message: `“${info.lemma}” forms the perfect with sinn (${c.text})`,
          confidence: "high",
        });
      } else if (info.aux === "hunn" && SINN_TO_HUNN[a]) {
        out.push({
          kind: "auxiliary", text: aux.tok.text, start: aux.tok.start, end: aux.tok.end,
          suggestion: likeCase(aux.text, SINN_TO_HUNN[a]),
          message: `“${info.lemma}” forms the perfect with hunn (${c.text}) — unless this is a state/passive (“ass gebaut”) or an adjective`,
          confidence: "low",
        });
      }
      break; // first confirmed participle decides
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* all together                                                      */
/* ---------------------------------------------------------------- */

export async function checkGrammar(text: string, opts: GrammarOptions): Promise<GrammarIssue[]> {
  const budget = new Budget(opts.maxLookups ?? 60);
  const [g, a, x] = await Promise.all([
    checkGermanisms(opts.unknownWords ?? [], opts.lexicon, new Budget(opts.maxLookups === 0 ? 0 : 12)),
    checkArticlesAndCase(text, opts.lexicon, budget),
    checkAuxiliaries(text, opts.lexicon, budget),
  ]);
  return [...g, ...a, ...x].sort((p, q) => p.start - q.start || p.kind.localeCompare(q.kind));
}
