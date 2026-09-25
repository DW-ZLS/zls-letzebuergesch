import { config } from "../config.js";
import type {
  Entry,
  Example,
  Meaning,
  RawEntryResponse,
  RawExample,
  RawMeaning,
  RawPart,
  RawSearchResult,
  SearchHit,
  TargetLang,
  Translation,
} from "./types.js";
import { TARGET_LANGS } from "./types.js";

const POS_LABELS: Record<string, string> = {
  SUBST: "noun",
  VRB: "verb",
  ADJ: "adjective",
  ADV: "adverb",
  PREP: "preposition",
  KONJ: "conjunction",
  CONJ: "conjunction",
  PRON: "pronoun",
  ART: "article",
  INTERJ: "interjection",
  INTJ: "interjection",
  NUM: "numeral",
  PART: "particle",
  AFFIX: "affix",
  PREF: "prefix",
  SUFF: "suffix",
  ABR: "abbreviation",
  ABK: "abbreviation",
  PHR: "phrase",
};

const GENDER_LABELS: Record<string, string> = {
  M: "masculine",
  F: "feminine",
  N: "neuter",
  PL: "plural only",
};

/** "SUBST+N" -> "noun (neuter)", "VRB" -> "verb", unknown codes are returned as-is. */
export function posLabel(code: string | undefined): string {
  if (!code) return "";
  const [head, ...rest] = code.split("+");
  const base = POS_LABELS[head] ?? head;
  const extras = rest.map((r) => GENDER_LABELS[r] ?? r).filter(Boolean);
  return extras.length ? `${base} (${extras.join(", ")})` : base;
}

export const entryUrl = (id: string) => `${config.lodWebBase}/artikel/${encodeURIComponent(id)}`;

export const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

export function normalizeSearchResult(r: RawSearchResult): SearchHit | null {
  const id = r.article_id ?? r.id;
  if (!id) return null;
  return {
    id,
    lemma: r.word_lb ?? id,
    pos: r.pos ?? "",
    posLabel: posLabel(r.pos),
    matchedForms: (r.matches ?? []).map(stripTags).filter(Boolean),
    erroneous: Boolean(r.erroneous),
    signLanguage: Boolean(r.sign_language),
    scientificName: r.scientific_name || undefined,
    meanings: (r.meanings ?? []).map((m) => ({
      id: m.id ?? "",
      number: m.number ?? 0,
      translation: m.translation ?? "",
      secondaryHeadword: m.secondaryHeadword || undefined,
    })),
    url: entryUrl(id),
  };
}

/* ---------------------------------------------------------------- */
/* Rich-text parts (examples, glosses)                               */
/* ---------------------------------------------------------------- */

/**
 * Flatten a list of LOD "parts" into readable text. Words are space-separated
 * unless `joinWithPreviousWord` is set (elisions like d'Kanner, punctuation).
 */
export function partsToText(parts: RawPart[] | undefined, boldHeadword = false): string {
  if (!parts?.length) return "";
  let out = "";
  for (const p of parts) {
    let piece: string;
    if (p.parts?.length) piece = partsToText(p.parts, boldHeadword);
    else if (typeof p.content === "string") piece = p.content;
    else continue;
    if (!piece) continue;
    if (p.type === "inflectedHeadword" && boldHeadword) piece = `**${piece}**`;
    if (p.type === "attribute") continue; // surfaced separately as a label
    if (out && !p.joinWithPreviousWord) out += " ";
    out += piece;
  }
  return out.replace(/\s+([,.;:!?])/g, "$1").trim();
}

function collectAttributes(parts: RawPart[] | undefined, acc: string[] = []): string[] {
  for (const p of parts ?? []) {
    if (p.type === "attribute" && typeof p.content === "string") acc.push(p.content);
    if (p.parts) collectAttributes(p.parts, acc);
  }
  return acc;
}

export function normalizeExample(ex: RawExample, boldHeadword = true): Example {
  const top = ex.parts ?? [];
  const textParts = top.filter((p) => p.type !== "gloss");
  const glossParts = top.filter((p) => p.type === "gloss");
  return {
    text: partsToText(textParts, boldHeadword),
    gloss: glossParts.length ? partsToText(glossParts, false) : undefined,
    labels: collectAttributes(top),
    audio: ex.audioFiles?.aac ?? ex.audioFiles?.ogg,
  };
}

/* ---------------------------------------------------------------- */
/* Translations                                                      */
/* ---------------------------------------------------------------- */

/**
 * Target-language parts come as a flat sequence, e.g.
 *   translation "to do", semanticClarifier "an activity", translation "to make", ...
 * A clarifier belongs to the translation right before it.
 */
export function normalizeTranslations(parts: RawPart[] | undefined): Translation[] {
  const out: Translation[] = [];
  for (const p of parts ?? []) {
    const text = p.parts?.length ? partsToText(p.parts) : (p.content ?? "").trim();
    if (!text) continue;
    if (p.type === "translation" || (!p.type && !out.length)) {
      out.push({ text });
    } else if (p.type === "semanticClarifier" && out.length) {
      const last = out[out.length - 1];
      last.clarifier = last.clarifier ? `${last.clarifier}; ${text}` : text;
    } else if (out.length) {
      const last = out[out.length - 1];
      (last.notes ??= []).push(text);
    } else {
      out.push({ text });
    }
  }
  return out;
}

export const formatTranslation = (t: Translation) =>
  t.text + (t.clarifier ? ` [${t.clarifier}]` : "") + (t.notes?.length ? ` (${t.notes.join("; ")})` : "");

/* ---------------------------------------------------------------- */
/* Entry                                                             */
/* ---------------------------------------------------------------- */

const KNOWN_MEANING_KEYS = new Set([
  "meaningID",
  "number",
  "meaningVideo",
  "inflection",
  "targetLanguages",
  "examples",
]);

function scalarExtras(obj: Record<string, unknown>, known: Set<string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k) || v === null || v === undefined || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") extra[k] = String(v);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length) extra[k] = v.join(", ");
  }
  return extra;
}

export function normalizeMeaning(m: RawMeaning, idx: number): Meaning {
  const translations: Partial<Record<TargetLang, Translation[]>> = {};
  for (const lang of TARGET_LANGS) {
    const t = m.targetLanguages?.[lang];
    if (t) translations[lang] = normalizeTranslations(t.parts);
  }
  const examples = (m.examples ?? []).map((e) => normalizeExample(e));
  return {
    id: m.meaningID ?? "",
    number: m.number ?? idx + 1,
    translations,
    forms: (m.inflection?.forms ?? []).map((f) => f.content ?? "").filter(Boolean),
    examples,
    exampleCount: examples.length,
    extra: scalarExtras(m as Record<string, unknown>, KNOWN_MEANING_KEYS),
  };
}

const asArray = (v: string[] | string | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Walks the (loosely structured) infobox tree and pulls out internal links. */
function collectInternalLinks(node: unknown, acc: Array<{ lemma: string; id: string }>) {
  if (Array.isArray(node)) {
    for (const n of node) collectInternalLinks(n, acc);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.tag === "internalLink" && typeof o.content === "string" && typeof o.idRef === "string") {
      acc.push({ lemma: o.content, id: o.idRef });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") collectInternalLinks(v, acc);
  }
  return acc;
}

export function normalizeEntry(res: RawEntryResponse): Entry | null {
  const e = res.entry;
  if (!e?.lod_id) return null;

  const synonyms: Entry["synonyms"] = [];
  const otherSynonyms: string[] = [];
  if (e.allSynonyms && !Array.isArray(e.allSynonyms)) {
    for (const g of e.allSynonyms.synonymGroups ?? []) {
      const syns = (g.toSynonyms ?? []).map((s) => s.syn ?? "").filter(Boolean);
      if (syns.length) synonyms.push({ terms: g.fromTerms ?? [], synonyms: syns });
    }
    for (const s of e.allSynonyms.otherPotentialSynonyms?.synonyms ?? []) if (s.syn) otherSynonyms.push(s.syn);
  }

  const seeAlso = collectInternalLinks(e.infoboxes, []);
  const seen = new Set<string>();

  return {
    id: e.lod_id,
    lemma: e.lemma ?? e.lod_id,
    pos: e.partOfSpeech ?? "",
    posLabel: posLabel(e.partOfSpeech),
    ipa: e.ipa || undefined,
    nRuleForm: e.nRuleForm || undefined,
    trademark: Boolean(e.trademark),
    audio: e.audioFiles?.aac ?? e.audioFiles?.ogg,
    audioString: e.audioString || undefined,
    url: entryUrl(e.lod_id),
    sections: (e.microStructures ?? []).map((ms) => ({
      pos: ms.partOfSpeech ?? e.partOfSpeech ?? "",
      posLabel: posLabel(ms.partOfSpeech ?? e.partOfSpeech),
      auxiliaryVerb: ms.auxiliaryVerb,
      pastParticiple: asArray(ms.pastParticiple),
      units: (ms.grammaticalUnits ?? []).map((gu) => ({
        grammaticalInformation: asArray(gu.grammaticalInformation),
        meanings: (gu.meanings ?? []).map(normalizeMeaning),
      })),
    })),
    synonyms,
    otherSynonyms,
    seeAlso: seeAlso.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true))),
    categories: (e.categories ?? []).map((c) => c.label ?? c.code ?? "").filter(Boolean),
    hasInflectionTables: Boolean(e.tables && Object.keys(e.tables).length),
    tables: e.tables,
  };
}
