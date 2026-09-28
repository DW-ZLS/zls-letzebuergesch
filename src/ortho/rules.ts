/**
 * Retrieval over the official orthography ("D'Lëtzebuerger Orthografie", CPLL/ZLS),
 * loaded from resources/orthografie/reegelen.jsonl (generated from the PDF).
 */
import fs from "node:fs";
import path from "node:path";
import { terms } from "../corpus/similar.js";
import { resourcesDir } from "../grammar/resources.js";

export interface RuleSection {
  id: string;
  title: string;
  path: string[];
  page: number;
  text: string;
  examples: string[];
  cross_refs: string[];
  variants: Array<{ main: string; secondary: string }>;
  subsections: string[];
}

export const ORTHO_SOURCE = "D’Lëtzebuerger Orthografie (CPLL/ZLS 2019, 6. Oplo 2024)";

interface Index {
  sections: Map<string, RuleSection>;
  order: string[];
  tf: Map<string, Map<string, number>>;
  len: Map<string, number>;
  df: Map<string, number>;
  avgLen: number;
  words: Map<string, Set<string>>;
}

let index: Index | null = null;

const lc = (s: string) => s.toLocaleLowerCase("lb").replace(/’/g, "'");

export function loadRules(): Index {
  if (index) return index;
  const file = path.join(resourcesDir(), "orthografie", "reegelen.jsonl");
  const sections = new Map<string, RuleSection>();
  const order: string[] = [];
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    raw = "";
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as RuleSection;
    sections.set(r.id, r);
    order.push(r.id);
  }
  const tf = new Map<string, Map<string, number>>();
  const len = new Map<string, number>();
  const df = new Map<string, number>();
  const words = new Map<string, Set<string>>();
  for (const id of order) {
    const s = sections.get(id)!;
    const doc = `${s.title} ${s.title} ${s.title} ${s.path.join(" ")} ${s.text.replace(/\*/g, "")}`;
    const t = terms(doc);
    const m = new Map<string, number>();
    for (const x of t) m.set(x, (m.get(x) ?? 0) + 1);
    for (const x of m.keys()) df.set(x, (df.get(x) ?? 0) + 1);
    tf.set(id, m);
    len.set(id, t.length);
    for (const e of s.examples) {
      const keys = new Set([lc(e), ...lc(e).split(/[\s,;/()–-]+/).filter((w) => w.length > 1)]);
      for (const k of keys) {
        if (!words.has(k)) words.set(k, new Set());
        words.get(k)!.add(id);
      }
    }
  }
  const avgLen = [...len.values()].reduce((a, b) => a + b, 0) / Math.max(1, len.size);
  index = { sections, order, tf, len, df, avgLen, words };
  return index;
}

export function getSection(id: string): RuleSection | undefined {
  return loadRules().sections.get(id.replace(/^§\s*/, "").replace(/\.$/, "").trim());
}

/** Query expansion so that English/German/French questions find the Luxembourgish rule text. */
const EXPANSIONS: Array<[RegExp, string]> = [
  [/capital|upper|lower.?case|gro(ß|ss)schreib|kleinschreib|majuscule|minuscule/i, "Groussschreiwung Klengschreiwung groussgeschriwwen klenggeschriwwen"],
  [/weekday|days? of the week|wochentag|jours? de la semaine|monday|montag|lundi/i, "Wochendeeg Méindeg Dageszäiten"],
  [/time of day|tageszeit|morning|evening|morgens|abends/i, "Dageszäiten moies owes Mueren Owend"],
  [/comma|komma|virgule/i, "Komma"],
  [/hyphen|bindestrich|trait d.union/i, "Bindestréch"],
  [/apostroph/i, "Apostroph"],
  [/n.?rule|eifel|n-regel|règle du n/i, "n-Reegel"],
  [/number|zahl|chiffre|digit|nombre/i, "Zuelen Zuel"],
  [/abbrev|abkürz|abréviation/i, "Ofkierzungen Ofkierzung"],
  [/quot|anführung|guillemet/i, "Gänseféisercher"],
  [/compound|zusammen|together|composé|soudé/i, "Zesummeschreiwung zesummegeschriwwen Zesummesetzungen"],
  [/separate|getrennt|apart|séparé/i, "auserneegeschriwwen Getrenntschreiwung"],
  [/loan|fremdw|foreign|emprunt/i, "Friemwierder"],
  [/french|französisch|français/i, "Franséisch franséisch"],
  [/english|englisch|anglais/i, "Englesch englesch"],
  [/greek|latin|griech|latein/i, "griichesch laténgesch"],
  [/verb/i, "Verben Verb"],
  [/vowel|vokal|voyelle/i, "Vokal Vokaler"],
  [/long|lang/i, "laang laange"],
  [/short|kurz|court/i, "kuerz kuerze"],
  [/doubl|verdoppel/i, "verduebelt Verdueblung duebel"],
  [/diphth/i, "Diphthongen Diphthong"],
  [/(lengthening|stretch|dehnungs)[- ]?h|silent h|h muet/i, "Längt markéieren Deenungs"],
  [/plural|pluriel/i, "Pluriel"],
  [/ß|eszett|sharp s/i, "ss ß schaarfen"],
  [/accent|akzent|aigu|grave|circonflexe/i, "Accent"],
  [/umlaut|trema|tréma|diaeresis|ë/i, "Treema"],
  [/question mark|fragezeichen|point d.interrogation/i, "Froenzeechen"],
  [/exclamation|ausrufezeichen/i, "Ausruffzeechen"],
  [/colon|doppelpunkt|deux.points/i, "Doppelpunkt"],
  [/semicolon|semikolon|point.virgule/i, "Stréchpunkt Semikolon"],
  [/dash|gedankenstrich|tiret/i, "Gedankestréch"],
  [/title|titel|titre/i, "Titelen Titel"],
  [/name|eigenname|nom propre/i, "Nimm Numm"],
  [/polite|höflich|formal address|vouvoie|sie-form/i, "Héiflechkeetspronomen Urieden Dir Iech"],
  [/sentence start|satzanfang|début de phrase/i, "Sazufank"],
  [/diminutiv/i, "Diminutiv chen"],
  [/particip|partizip/i, "Partizip"],
  [/infinitiv/i, "Infinitiv"],
  [/final consonant|auslaut|devoic|verhärtung/i, "Ennverhäerdung Laut um Enn"],
  [/space|leerzeichen|espace/i, "Sputt"],
  [/unit|einheit|percent|prozent|pour.?cent/i, "Moosseenheeten Prozentzeechen"],
];

/** Topics whose key paragraph is hard to reach by keywords alone. */
const TOPIC_BOOST: Array<[RegExp, string[]]> = [
  [/n.?(rule|reegel|regel)|eifel/i, ["6.1.1", "6.1.2.2", "6.1.2.4"]],
  [/(lengthening|stretch|dehnungs|deenungs)[- ]?h|\bh\b.*(long|laang|läng)/i, ["4.3.1", "1.2.3"]],
  [/(^|[^\p{L}])[ëé]($|[^\p{L}])|treema|accent aigu/iu, ["2.2.2", "2.2.3"]],
  [/ß|eszett/i, ["4.3.4.2", "4.3.4.4"]],
  [/\bee\b|laangen e|long e/i, ["2.1"]],
  [/r.?(rule|reegel)|ier|uer/i, ["3.2.1"]],
];

/** Single letters in a question ("wéini schreift een h?") point to their chapter. */
const LETTER_SECTIONS: Record<string, string[]> = {
  n: ["6.1.1", "6.1.2.2", "6.1.2.4"], h: ["4.3.1"], s: ["4.3.4.2", "4.3.4.3", "4.3.4.4"], z: ["4.3.4.7"], g: ["4.3.2.1", "4.3.2.3"],
  j: ["4.3.3.2"], k: ["4.3.5.1"], q: ["4.3.5.1"], x: ["4.3.5.3"], f: ["4.3.6.1"], v: ["4.3.6.1"], w: ["4.3.6.1"],
  e: ["2", "2.1"], "é": ["2.2.2"], "ë": ["2.2.3"], "ä": ["2.2.1"], t: ["4.5"], r: ["3.2.1"],
};

function expand(query: string): string {
  let q = query;
  for (const [re, add] of EXPANSIONS) if (re.test(query)) q += " " + add;
  return q;
}

export function searchRules(query: string, k = 3): Array<{ section: RuleSection; score: number }> {
  const idx = loadRules();
  const q = [...new Set(terms(expand(query)))];
  const N = idx.order.length;
  const scores = new Map<string, number>();
  for (const term of q) {
    const df = idx.df.get(term);
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (term.endsWith("*") ? 0.5 : 1);
    for (const id of idx.order) {
      const f = idx.tf.get(id)!.get(term);
      if (!f) continue;
      const L = idx.len.get(id)!;
      scores.set(id, (scores.get(id) ?? 0) + (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * L) / idx.avgLen)));
    }
  }
  for (const m of query.matchAll(/(?:^|[^\p{L}])(\p{L})(?=[^\p{L}]|$)/gu)) {
    for (const id of LETTER_SECTIONS[m[1].toLowerCase()] ?? []) if (idx.sections.has(id)) scores.set(id, (scores.get(id) ?? 0) + 6);
  }
  for (const [re, ids] of TOPIC_BOOST) if (re.test(query)) for (const id of ids) if (idx.sections.has(id)) scores.set(id, (scores.get(id) ?? 0) + 8);
  // exact word matches in the examples get a bonus
  for (const w of query.split(/\s+/)) {
    for (const id of idx.words.get(lc(w)) ?? []) scores.set(id, (scores.get(id) ?? 0) + 1.5);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, score]) => ({ section: idx.sections.get(id)!, score }));
}

export function sectionsForWord(word: string): RuleSection[] {
  const idx = loadRules();
  const ids = idx.words.get(lc(word)) ?? new Set<string>();
  return [...ids].map((id) => idx.sections.get(id)!).sort((a, b) => idx.order.indexOf(a.id) - idx.order.indexOf(b.id));
}

export const cite = (s: RuleSection) => `${ORTHO_SOURCE}, §${s.id}, S. ${s.page}`;

export function formatSection(s: RuleSection, opts: { withChildren?: boolean; maxChars?: number } = {}): string {
  const max = opts.maxChars ?? 6000;
  const L = [`## §${s.id} ${s.title}`, `*${[...s.path, `${s.id} ${s.title}`].join(" › ")} (S. ${s.page})*`, ""];
  if (s.text.trim()) L.push(s.text.trim());
  if (opts.withChildren && s.subsections.length) {
    for (const cid of s.subsections) {
      const c = getSection(cid);
      if (!c) continue;
      L.push("", `### §${c.id} ${c.title} (S. ${c.page})`, c.text.trim());
      if (c.subsections.length) L.push(`Subsections: ${c.subsections.map((x) => `§${x}`).join(", ")}`);
    }
  } else if (s.subsections.length) {
    L.push("", `Subsections: ${s.subsections.map((x) => { const c = getSection(x); return `§${x}${c ? ` ${c.title}` : ""}`; }).join("; ")}`);
  }
  if (s.variants.length) L.push("", `Variants (main / secondary): ${s.variants.map((v) => `${v.main} / ${v.secondary}`).join("; ")}`);
  if (s.cross_refs.length) L.push("", `See also: ${s.cross_refs.map((x) => `§${x}`).join(", ")}`);
  let out = L.join("\n");
  if (out.length > max) out = out.slice(0, max) + "\n…(truncated; ask for a subsection)";
  return out + `\n\nSource: ${cite(s)}.`;
}
