import type { Entry, SearchHit, TargetLang } from "./types.js";
import { formatTranslation } from "./normalize.js";

const LANG_NAMES: Record<string, string> = {
  lb: "Luxembourgish",
  de: "German",
  fr: "French",
  en: "English",
  pt: "Portuguese",
};

export const ATTRIBUTION =
  "Source: Lëtzebuerger Online Dictionnaire (LOD), Zenter fir d'Lëtzebuerger Sprooch — lod.lu, CC0.";

export function formatSearch(query: string, lang: string, hits: SearchHit[], limit: number): string {
  if (!hits.length) {
    return [
      `No LOD entries found for "${query}" (${LANG_NAMES[lang] ?? lang}).`,
      lang === "lb"
        ? "Tip: LOD search is exact on headwords and inflected forms, not fuzzy. If the spelling may be off, run lb_spellcheck on the word first, or search from German/French/English with the `lang` parameter."
        : "Tip: try a simpler base form (infinitive, singular), or search in another language.",
    ].join("\n");
  }
  const shown = hits.slice(0, limit);
  const lines = [`LOD results for "${query}" (${LANG_NAMES[lang] ?? lang}) — ${hits.length} hit(s)${hits.length > limit ? `, showing ${limit}` : ""}:`, ""];
  for (const h of shown) {
    let line = `- **${h.lemma}** — ${h.posLabel || h.pos} — id \`${h.id}\``;
    if (h.scientificName) line += ` — *${h.scientificName}*`;
    if (h.erroneous) line += " — ⚠ query matches a known *erroneous* spelling of this word";
    if (h.matchedForms.length && !h.matchedForms.every((f) => f.toLowerCase() === h.lemma.toLowerCase()))
      line += ` — matched form: ${h.matchedForms.join(", ")}`;
    lines.push(line);
    for (const m of h.meanings.slice(0, 6)) {
      lines.push(`  - ${m.number ? `${m.number}. ` : ""}${m.translation}${m.secondaryHeadword ? ` (${m.secondaryHeadword})` : ""}`);
    }
  }
  lines.push("", "Use lod_get_entry with an id for meanings, translations, examples and pronunciation.", ATTRIBUTION);
  return lines.join("\n");
}

export interface EntryFormatOptions {
  languages: TargetLang[];
  maxExamples: number;
  includeExamples: boolean;
}

export function formatEntry(e: Entry, opts: EntryFormatOptions): string {
  const L: string[] = [];
  L.push(`# ${e.lemma}  (${e.posLabel || e.pos})`);
  const meta: string[] = [`LOD id: \`${e.id}\``];
  if (e.ipa) meta.push(`IPA: /${e.ipa}/`);
  if (e.nRuleForm) meta.push(`n-rule form: **${e.nRuleForm}** (Eifeler Regel)`);
  if (e.trademark) meta.push("trademark");
  L.push(meta.join(" · "));
  if (e.audioString) L.push(`Pronunciation recording: “${e.audioString}”${e.audio ? ` — ${e.audio}` : ""}`);
  else if (e.audio) L.push(`Audio: ${e.audio}`);
  L.push(`Link: ${e.url}`);

  for (const s of e.sections) {
    if (e.sections.length > 1) L.push("", `## ${s.posLabel || s.pos}`);
    const gram: string[] = [];
    if (s.auxiliaryVerb) gram.push(`auxiliary: ${s.auxiliaryVerb}`);
    if (s.pastParticiple.length) gram.push(`past participle: ${s.pastParticiple.join(" / ")}`);
    if (gram.length) L.push(gram.join(" · "));

    for (const u of s.units) {
      if (u.grammaticalInformation.length) L.push("", `*${u.grammaticalInformation.join(", ")}*`);
      for (const m of u.meanings) {
        L.push("", `**${m.number}.**`);
        for (const lang of opts.languages) {
          const t = m.translations[lang];
          if (t?.length) L.push(`- ${lang.toUpperCase()}: ${t.map(formatTranslation).join("; ")}`);
        }
        if (m.forms.length) L.push(`- Forms listed: ${m.forms.join(", ")}`);
        for (const [k, v] of Object.entries(m.extra)) L.push(`- ${k}: ${v}`);
        if (opts.includeExamples && m.examples.length) {
          const ex = m.examples.slice(0, opts.maxExamples);
          L.push(`- Examples${m.examples.length > ex.length ? ` (${ex.length} of ${m.examples.length})` : ""}:`);
          for (const x of ex) {
            const label = x.labels.length ? `[${x.labels.join(", ")}] ` : "";
            L.push(`  - ${label}${x.text}${x.gloss ? ` — *${x.gloss}*` : ""}`);
          }
        } else if (!opts.includeExamples && m.exampleCount) {
          L.push(`- ${m.exampleCount} example(s) available`);
        }
      }
    }
  }

  if (e.synonyms.length || e.otherSynonyms.length) {
    L.push("", "## Synonyms");
    for (const g of e.synonyms) L.push(`- ${g.terms.length ? `${g.terms.join(", ")} → ` : ""}${g.synonyms.join(", ")}`);
    if (e.otherSynonyms.length) L.push(`- other possible synonyms: ${e.otherSynonyms.join(", ")}`);
  }
  if (e.seeAlso.length) {
    const shown = e.seeAlso.slice(0, 30);
    L.push("", `## Related entries${e.seeAlso.length > shown.length ? ` (${shown.length} of ${e.seeAlso.length})` : ""}`);
    L.push(shown.map((l) => `${l.lemma} (\`${l.id}\`)`).join(", "));
  }
  if (e.categories.length) L.push("", `Categories: ${e.categories.join("; ")}`);
  if (e.hasInflectionTables) L.push("", "Full inflection tables available via lod_get_inflection.");
  L.push("", ATTRIBUTION);
  return L.join("\n");
}

/* ---------------------------------------------------------------- */
/* Inflection tables                                                 */
/* ---------------------------------------------------------------- */

const PERSONS: Record<string, string> = {
  p1: "ech",
  p2: "du",
  p3: "hien/hatt/si",
  p4: "mir",
  p5: "dir",
  p6: "si",
};

const TENSE_LABELS: Record<string, string> = {
  present: "present",
  presentSimple: "present",
  pastSimple: "simple past (Imperfekt)",
  presentPerfect: "perfect",
  pastPerfect: "pluperfect",
};

const MOOD_LABELS: Record<string, string> = {
  indicative: "Indicative",
  conditional: "Conditional (Konjunktiv II)",
  imperative: "Imperative",
  subjunctive: "Subjunctive",
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function conditionalLabel(mood: string, tense: string): string {
  // In LOD's conditional block, "presentPerfect" is the periphrastic géif/géing form.
  if (mood === "conditional" && tense === "presentPerfect") return "periphrastic (géif/géing + inf.)";
  if (mood === "conditional" && tense === "presentSimple") return "synthetic";
  return TENSE_LABELS[tense] ?? tense;
}

function mdTable(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`),
  ];
}

export function formatVerbTable(t: Record<string, unknown>): string[] {
  const L: string[] = [];
  const attrs = isObj(t["@attributes"]) ? t["@attributes"] : {};
  const head: string[] = [];
  if (t.infinitive) head.push(`infinitive: **${t.infinitive}**`);
  if (t.pastParticiple) head.push(`past participle: ${t.pastParticiple}`);
  if (t.auxiliaryVerb) head.push(`auxiliary: ${t.auxiliaryVerb}`);
  if (attrs.separableVerb) head.push(`separable: ${attrs.separableVerb}`);
  if (attrs.model && attrs.model !== attrs.id) head.push(`conjugation model: ${attrs.model}`);
  if (head.length) L.push(head.join(" · "));

  for (const [mood, tenses] of Object.entries(t)) {
    if (!isObj(tenses) || mood === "@attributes") continue;
    const tenseKeys = Object.keys(tenses).filter((k) => isObj(tenses[k]));
    if (!tenseKeys.length) continue;
    L.push("", `### ${MOOD_LABELS[mood] ?? mood}`);
    const persons = Object.keys(PERSONS).filter((p) => tenseKeys.some((tk) => (tenses[tk] as Record<string, unknown>)[p]));
    const rows = persons.map((p) => [PERSONS[p], ...tenseKeys.map((tk) => String((tenses[tk] as Record<string, unknown>)[p] ?? "–"))]);
    L.push(...mdTable(["", ...tenseKeys.map((tk) => conditionalLabel(mood, tk))], rows));
  }
  return L;
}

const CASES = ["nominative", "accusative", "dative", "genitive"];

export function formatAdjTable(t: Record<string, unknown>): string[] {
  const L: string[] = [];
  if (isObj(t.basicForms)) {
    L.push(Object.entries(t.basicForms).map(([k, v]) => `${k}: **${v}**`).join(" · "));
  }
  if (isObj(t.declension)) {
    for (const [degree, numbers] of Object.entries(t.declension)) {
      if (!isObj(numbers)) continue;
      const cols: Array<{ label: string; forms: Record<string, unknown> }> = [];
      for (const [num, genders] of Object.entries(numbers)) {
        if (!isObj(genders)) continue;
        for (const [g, forms] of Object.entries(genders)) {
          if (!isObj(forms)) continue;
          const gl = g === "masculineFeminineNeutral" ? "all genders" : g === "neutral" ? "neuter" : g;
          cols.push({ label: `${num === "plural" ? "pl." : "sg."} ${gl}`, forms });
        }
      }
      if (!cols.length) continue;
      L.push("", `### ${degree}`);
      const caseKeys = CASES.filter((c) => cols.some((col) => col.forms[c]));
      L.push(...mdTable(["", ...cols.map((c) => c.label)], caseKeys.map((c) => [c, ...cols.map((col) => String(col.forms[c] ?? "–"))])));
    }
  }
  return L;
}

/** Fallback for table types we have not seen yet: nested bullet list. */
export function formatGeneric(node: unknown, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  if (!isObj(node)) return [`${pad}- ${String(node)}`];
  const out: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === "@attributes") continue;
    if (isObj(v)) out.push(`${pad}- ${k}:`, ...formatGeneric(v, depth + 1));
    else if (Array.isArray(v)) out.push(`${pad}- ${k}: ${v.map((x) => (isObj(x) ? JSON.stringify(x) : String(x))).join(", ")}`);
    else out.push(`${pad}- ${k}: ${String(v)}`);
  }
  return out;
}

export function formatInflection(e: Entry): string {
  const L: string[] = [`# Inflection: ${e.lemma} (${e.posLabel || e.pos}) — \`${e.id}\``];
  if (e.nRuleForm) L.push(`n-rule (Eifeler Regel) form: **${e.nRuleForm}**`);
  let any = false;
  for (const [kind, table] of Object.entries(e.tables ?? {})) {
    if (!isObj(table)) continue;
    any = true;
    if (kind === "verbConjugation") L.push("", "## Conjugation", ...formatVerbTable(table));
    else if (kind === "adjDeclension") L.push("", "## Declension", ...formatAdjTable(table));
    else L.push("", `## ${kind}`, ...formatGeneric(table));
  }
  if (!any) {
    const forms = new Set<string>();
    for (const s of e.sections) for (const u of s.units) for (const m of u.meanings) m.forms.forEach((f) => forms.add(f));
    const pp = e.sections.flatMap((s) => s.pastParticiple);
    if (forms.size || pp.length) {
      any = true;
      L.push("", "LOD has no full table for this entry; forms listed in the entry:");
      if (forms.size) L.push(`- ${[...forms].join(", ")}`);
      if (pp.length) L.push(`- past participle: ${pp.join(" / ")}`);
    }
  }
  if (!any) L.push("", "LOD provides no inflection data for this entry (typically uninflected words).");
  L.push("", `Link: ${e.url}`, ATTRIBUTION);
  return L.join("\n");
}
