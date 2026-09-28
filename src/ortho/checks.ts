/**
 * Deterministic orthography checks taken from the official rules
 * (D'Lëtzebuerger Orthografie, CPLL/ZLS 2019, 6th printing 2024).
 * Every finding cites the paragraph (§) it is based on.
 */
import type { Confidence } from "../spell/nrule.js";

export interface OrthoIssue {
  check: string;
  rule: string; // § in the official orthography
  text: string;
  start: number;
  end: number;
  suggestion: string;
  message: string;
  confidence: Confidence;
}

type Checker = (text: string) => OrthoIssue[];

function all(re: RegExp, text: string, fn: (m: RegExpExecArray) => OrthoIssue | null): OrthoIssue[] {
  const out: OrthoIssue[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const r = fn(m);
    if (r) out.push(r);
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

const L = "\\p{L}\\p{M}";

/* §10.2.2, §10.2.3, §10.3.3, §10.3.4: no space before ! ? ; : */
const spaceBeforePunct: Checker = (text) =>
  all(new RegExp(`([${L}\\d)“”"»])( +|\\u00a0|\\u202f)([!?;:])(?!\\d)`, "gu"), text, (m) => {
    // "10 : 30" and emoticons are rare; ratios like "3 : 5" contain digits on both sides
    const start = m.index + m[1].length;
    const rule = m[3] === "!" ? "10.2.2" : m[3] === "?" ? "10.2.3" : m[3] === ";" ? "10.3.3" : "10.3.4";
    return {
      check: "punct-space", rule, text: m[2] + m[3], start, end: start + m[2].length + 1, suggestion: m[3],
      message: `no space before “${m[3]}” in Luxembourgish (unlike French)`, confidence: "high",
    };
  });

/* §8.5.1: multi-part abbreviations get a space after each point: z. B., d. h., a. d. R., ë. a. */
const abbrevSpacing: Checker = (text) =>
  all(new RegExp(`(?<![${L}.])((?:[${L}]{1,2}\\.){2,})(?![${L}])`, "gu"), text, (m) => {
    const parts = m[1].match(new RegExp(`[${L}]{1,2}\\.`, "gu")) ?? [];
    if (parts.length < 2) return null;
    const fixed = parts.join(" ");
    if (/^(asw|etc|usw|ca|evtl|allg)\./i.test(m[1])) return null;
    return {
      check: "abbreviation", rule: "8.5.1", text: m[1], start: m.index, end: m.index + m[1].length, suggestion: fixed,
      message: "abbreviations of several words take a space after each point", confidence: "high",
    };
  });

/* §8.5.1: a space between a number and the unit / % / € (except ' " ° and suffixes like 100%eg, 100stel) */
const unitSpacing: Checker = (text) =>
  all(new RegExp(`(?<![${L}\\d.,])(\\d+(?:[.,]\\d+)?)(%|€|EUR|mm|cm|km|kg|mg|ml|cl|m²|m³|qm|°C|°F|kW|MHz|GB|MB)(?![${L}\\d])`, "gu"), text, (m) => ({
    check: "unit-space", rule: "8.5.1", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: `${m[1]} ${m[2]}`,
    message: "a space goes between the number and the unit or % sign (3 cm, 10 %, 5 €)", confidence: "high",
  }));

/* §8.3: weekdays are nouns (capitalised); adverbial -s forms and haut/muer/gëschter … are lowercase */
const WEEKDAYS = ["Méindeg", "Dënschdeg", "Mëttwoch", "Donneschdeg", "Freideg", "Samschdeg", "Sonndeg"];
const ADVERB_S = ["méindes", "dënschdes", "mëttwochs", "donneschdes", "freides", "samschdes", "sonndes", "moies", "mëttes", "owes", "nuets", "nomëttes", "mueres"];
const TIME_ADV = ["gëschter", "virgëschter", "hënt", "iwwermuer"]; // not haut/muer: d'Haut (skin), Muer (moor) are nouns
const DAYTIME = ["moien", "mueren", "mëtteg", "mëtten", "nomëtteg", "owend", "nuecht"];

function sentenceStart(text: string, idx: number): boolean {
  const before = text.slice(0, idx).replace(/[\s„“"«»'’(]+$/u, "");
  return before === "" || /[.!?…:]$/.test(before);
}

const daysAndTimes: Checker = (text) => {
  const out: OrthoIssue[] = [];
  const wd = new RegExp(`(?<![${L}])(${WEEKDAYS.map((d) => d.toLowerCase()).join("|")})(?![${L}])`, "gu");
  out.push(...all(wd, text, (m) => {
    const fixed = m[1][0].toUpperCase() + m[1].slice(1);
    return { check: "capitalisation", rule: "8.3", text: m[1], start: m.index, end: m.index + m[1].length, suggestion: fixed,
      message: "days of the week are capitalised (de Méindeg); only the -s adverbs are lowercase (méindes)", confidence: "high" };
  }));
  const adv = new RegExp(`(?<![${L}])(${[...ADVERB_S, ...TIME_ADV].map((d) => d[0].toUpperCase() + d.slice(1)).join("|")})(?![${L}])`, "gu");
  out.push(...all(adv, text, (m) => {
    if (sentenceStart(text, m.index)) return null;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/(d'|d’|der |eng |déi |hir |seng |meng )$/i.test(before) && /^Haut$/.test(m[1])) return null; // d'Haut = skin
    return { check: "capitalisation", rule: "8.3", text: m[1], start: m.index, end: m.index + m[1].length, suggestion: m[1].toLowerCase(),
      message: "adverbs of time (moies, owes, méindes, haut, muer, gëschter …) are written lowercase", confidence: TIME_ADV.includes(m[1].toLowerCase()) ? "medium" : "high" };
  }));
  const gest = new RegExp(`(?<![${L}])((?:vir)?gëschter)\\s+(${DAYTIME.join("|")})(?![${L}])`, "giu");
  out.push(...all(gest, text, (m) => {
    const dt = m[2];
    if (/^\p{Lu}/u.test(dt)) return null;
    const start = m.index + m[0].length - dt.length;
    return { check: "capitalisation", rule: "8.3", text: dt, start, end: start + dt.length, suggestion: dt[0].toUpperCase() + dt.slice(1),
      message: "after gëschter/virgëschter the time of day is capitalised (gëschter Mueren)", confidence: "high" };
  }));
  return out;
};

/* §2.2.3: ë never before ch, chs, ck, ng, nk, x; é never before sch */
const eAccents: Checker = (text) => {
  const out: OrthoIssue[] = [];
  out.push(...all(new RegExp(`(?<![${L}])([${L}]*?)ë(ch|ck|ng|nk|x)([${L}]*)`, "gu"), text, (m) => {
    const w = m[0];
    const i = m[1].length;
    const fixed = w.slice(0, i) + "é" + w.slice(i + 1);
    return { check: "e-accent", rule: "2.2.3", text: w, start: m.index, end: m.index + w.length, suggestion: fixed,
      message: `“ë” never stands before ${m[2]}; the short stressed e there is written “é”`, confidence: "high" };
  }));
  out.push(...all(new RegExp(`(?<![${L}])([${L}]*?)é(sch)([${L}]*)`, "gu"), text, (m) => {
    const w = m[0];
    const i = m[1].length;
    return { check: "e-accent", rule: "2.2.3", text: w, start: m.index, end: m.index + w.length, suggestion: w.slice(0, i) + "ë" + w.slice(i + 1),
      message: "“é” never stands before sch; write “ë”", confidence: "high" };
  }));
  return out;
};

/* §4.3.4.2: ß does not exist in Luxembourgish */
const eszett: Checker = (text) =>
  all(new RegExp(`[${L}]*ß[${L}]*`, "gu"), text, (m) => ({
    check: "eszett", rule: "4.3.4.2", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: m[0].replace(/ß/g, "ss"),
    message: "“ß” does not exist in Luxembourgish; it is written “ss” (the vowel before may need doubling: grouss, Fouss)", confidence: "high",
  }));

/* §2.3.3, §10.5.1: d', z', 't — apostrophe attached, correct character, lowercase after a leading apostrophe */
const apostrophes: Checker = (text) => {
  const out: OrthoIssue[] = [];
  out.push(...all(new RegExp(`(?<![${L}])([dDzZ])\\s*[´\`]\\s*([${L}])`, "gu"), text, (m) => ({
    check: "apostrophe", rule: "2.3.3", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: `${m[1]}’${m[2]}`,
    message: "use an apostrophe (’ or '), not an accent sign", confidence: "high",
  })));
  out.push(...all(new RegExp(`(?<![${L}])([dD])(['’]) +(\\p{Lu}[${L}]*)`, "gu"), text, (m) => ({
    check: "apostrophe", rule: "10.5.1", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: `${m[1]}${m[2]}${m[3]}`,
    message: "no space after the shortened article d’", confidence: "high",
  })));
  out.push(...all(/(^|[.!?]\s+)(['’])T(?=\s)/gu, text, (m) => {
    const start = m.index + m[1].length;
    return { check: "apostrophe", rule: "8.7.5", text: `${m[2]}T`, start, end: start + 2, suggestion: `${m[2]}t`,
      message: "after a sentence-initial apostrophe, write lowercase (’t ass kal)", confidence: "high" };
  }));
  // z' only in z'iessen (formal); otherwise informal (§2.3.3)
  out.push(...all(new RegExp(`(?<![${L}])([zZ])['’]([${L}]+)`, "gu"), text, (m) => {
    if (/^iessen$/i.test(m[2])) return null;
    return { check: "apostrophe", rule: "2.3.3", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: `${m[1]}e ${m[2]}`,
      message: "“ze” keeps its e in standard texts (ze entdecken); only z’iessen is written with an apostrophe", confidence: "low" };
  }));
  return out;
};

/* §4.4.1: the linking s is written separately: wann s de, ob s de, wat s de */
const linkingS: Checker = (text) =>
  all(new RegExp(`(?<![${L}])(wann|ob|wat|wou|wéi|datt|dass|well|wéini|firwat|déi|dat|deen|wien|wéivill|soubal|nodeems|obschonns)(['’]?s) +(de|du|d['’])(?![${L}])`, "giu"), text, (m) => {
    const fixed = `${m[1]} s ${m[3]}`;
    return { check: "linking-s", rule: "4.4.1", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: fixed,
      message: "the linking s stands on its own: “wann s de”, “ob s de”", confidence: "high" };
  });

/* §10.3.5: the dash (Gedankestréch) is "–", not a hyphen with spaces */
const dash: Checker = (text) =>
  all(new RegExp(`(?<=[${L}.,!?“”"]) - (?=[${L}„"])`, "gu"), text, (m) => ({
    check: "dash", rule: "10.3.5", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: " – ",
    message: "use the dash “–” (Gedankestréch) between words, not a hyphen", confidence: "medium",
  }));

/* §10.4.1: quotation marks „…“ (and ‚…‘ inside) */
const quotes: Checker = (text) =>
  all(/"([^"\n]{1,200})"|«\s?([^»\n]{1,200}?)\s?»/gu, text, (m) => ({
    check: "quotes", rule: "10.4.1", text: m[0], start: m.index, end: m.index + m[0].length, suggestion: `„${m[1] ?? m[2]}“`,
    message: "Luxembourgish uses low-high quotation marks „…“", confidence: "low",
  }));

/* §10.3.1.3: a comma before subordinate clauses introduced by datt, well, ob, obschonns, nodeems, iwwerdeems … */
const SUBORD = "datt|dass|well|ob|obschonns|obwuel|nodeems|iwwerdeems|soubal|esoubal|zanterdeems";
const COMPLEX_BEFORE = /^(fir|ouni|ausser|sou|esou|amplaz|bis|egal|jee|nodeem|och|souguer|grad|just|net|mee|awer|ma|an|a|oder|respektiv|wéi|als|Sekonnen|Minutten|Stonnen|Deeg|Woch|Wochen|Méint|Joer|Joren|kuerz|laang)$/i;
const commaBeforeSubclause: Checker = (text) =>
  all(new RegExp(`(?<![${L}])([${L}]+)( +)(${SUBORD})(?![${L}])`, "giu"), text, (m) => {
    if (COMPLEX_BEFORE.test(m[1])) return null;
    if (sentenceStart(text, m.index)) {
      // first word of a sentence directly followed by "datt" etc. ("Datt hien …" is fine; "Ech mengen datt" is not)
    }
    const start = m.index + m[1].length;
    return { check: "comma", rule: "10.3.1.3", text: `${m[1]} ${m[3]}`, start: m.index, end: start + m[2].length + m[3].length,
      suggestion: `${m[1]}, ${m[3]}`, message: `a subordinate clause with “${m[3]}” is separated by a comma`, confidence: "medium" };
  });

/* §8.7.5: a new sentence starts with a capital letter */
const sentenceCase: Checker = (text) =>
  all(new RegExp(`(?<![.])([.!?])( +)(\\p{Ll}[${L}]*)`, "gu"), text, (m) => {
    const before = text.slice(Math.max(0, m.index - 12), m.index + 1);
    // abbreviations and ordinals: z. B., d. h., asw., S. 11., 5. Abrëll, …
    if (/(?:^|[\s(.])(?:[\p{L}]{1,4}|asw|etc|ca|evtl|allg|Nr|Tel|Dr|\d+)\.$/u.test(before)) return null;
    if (m[1] !== "." && /^(sot|seet|huet|freet|rifft|mengt|duecht|schreift)$/i.test(m[3])) return null; // „…?“, sot hien
    const start = m.index + m[1].length + m[2].length;
    return { check: "capitalisation", rule: "8.7.5", text: m[3], start, end: start + m[3].length, suggestion: m[3][0].toUpperCase() + m[3].slice(1),
      message: "a sentence starts with a capital letter", confidence: "medium" };
  });

export const CHECKS: Record<string, { fn: Checker; title: string }> = {
  "punct-space": { fn: spaceBeforePunct, title: "No space before ! ? ; :" },
  abbreviation: { fn: abbrevSpacing, title: "Spacing in abbreviations" },
  "unit-space": { fn: unitSpacing, title: "Space between number and unit" },
  capitalisation: { fn: (t) => [...daysAndTimes(t), ...sentenceCase(t)], title: "Capitalisation" },
  "e-accent": { fn: eAccents, title: "é / ë" },
  eszett: { fn: eszett, title: "ß" },
  apostrophe: { fn: apostrophes, title: "Apostrophe" },
  "linking-s": { fn: linkingS, title: "Linking s" },
  dash: { fn: dash, title: "Dash" },
  quotes: { fn: quotes, title: "Quotation marks" },
  comma: { fn: commaBeforeSubclause, title: "Comma before subordinate clauses" },
};

export function checkOrthography(text: string, only?: string[]): OrthoIssue[] {
  const out: OrthoIssue[] = [];
  for (const [id, c] of Object.entries(CHECKS)) {
    if (only && !only.includes(id)) continue;
    out.push(...c.fn(text));
  }
  // de-duplicate overlapping findings of the same check
  out.sort((a, b) => a.start - b.start || a.check.localeCompare(b.check));
  return out.filter((x, i) => i === 0 || !(out[i - 1].start === x.start && out[i - 1].check === x.check));
}

/* ---------------------------------------------------------------- */
/* Hints that explain unknown words with the official rules          */
/* ---------------------------------------------------------------- */

export function ruleHintsForUnknownWord(word: string, suggestions: string[]): Array<{ rule: string; hint: string }> {
  const out: Array<{ rule: string; hint: string }> = [];
  const w = word.replace(/^[dDzZ]['’]/, "");
  if (/ß/.test(w)) out.push({ rule: "4.3.4.2", hint: "ß → ss" });
  if (/[aeiouäöü]h(?![aeiouäöüëé])[bcdfgklmnpqrstvwxz]/i.test(w) && !/(ch|sch|th|ph|rh)/i.test(w.replace(/[aeiouäöü]h/i, ""))) {
    out.push({ rule: "4.3.1", hint: "no lengthening h in Luxembourgish (Ausnam, Faart, Zuel)" });
  }
  if (/ie(?![rh])[bcdfgklmnpqstvwxz]/i.test(w) && !suggestions.some((s) => s.includes("ie")))
    out.push({ rule: "1.2.3", hint: "“ie” is a diphthong in Luxembourgish; a long i is written “ii” (Biischt)" });
  if (/ë(ch|ck|ng|nk|x)/.test(w)) out.push({ rule: "2.2.3", hint: "ë never before ch/ck/ng/nk/x → é" });
  if (/ph/i.test(w)) out.push({ rule: "4.3.6.2", hint: "the f-spelling is usually the main variant (Foto, Mikrofon)" });
  if (/^\p{Ll}/u.test(w) && suggestions.some((s) => s.toLocaleLowerCase("lb") === w.toLocaleLowerCase("lb") && /^\p{Lu}/u.test(s))) {
    out.push({ rule: "8.1.1", hint: "nouns are capitalised" });
  }
  if (/([aeiou])\1/.test(w) === false && /(tz|ck)$/.test(w) && /(au|ei|äi|éi|ou|ie|ue)/.test(w)) {
    out.push({ rule: "4.1.3", hint: "no doubled consonant (ck, tz) after a diphthong" });
  }
  return out;
}
