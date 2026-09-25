import fs from "node:fs/promises";
import path from "node:path";
import nspell from "nspell";
import { config } from "../config.js";
import { normApostrophe, splitElision, tokenize } from "./tokenize.js";

type NSpell = ReturnType<typeof nspell>;

let spellerPromise: Promise<NSpell> | null = null;

/**
 * The spellchecker.lu .dic carries Hunspell morphological fields
 * ("haut po:adverb", "Haut/e1k7 po:noun ts:feminine_singular"). nspell does not
 * understand them and, for entries without flags, treats "haut po:adverb" as the
 * word itself — ~20,000 words (incl. "haut") would be rejected. Strip them.
 */
export function stripMorphology(dic: string): string {
  return dic
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t].*$/, ""))
    .join("\n");
}

/** Lazily load the Hunspell dictionary (≈1 s, ≈70 MB heap) once per process. */
export function getSpeller(): Promise<NSpell> {
  spellerPromise ??= (async () => {
    let aff: Buffer;
    let dic: Buffer;
    if (config.hunspellDir) {
      const base = path.join(config.hunspellDir, config.hunspellName);
      [aff, dic] = await Promise.all([fs.readFile(`${base}.aff`), fs.readFile(`${base}.dic`)]);
    } else {
      const dict = (await import("dictionary-lb")).default;
      aff = Buffer.from(dict.aff);
      dic = Buffer.from(dict.dic);
    }
    return nspell({ aff, dic: stripMorphology(dic.toString("utf8")) });
  })();
  spellerPromise.catch(() => {
    spellerPromise = null; // allow a retry after a failed load
  });
  return spellerPromise;
}

export function dictionarySource(): string {
  return config.hunspellDir
    ? `custom Hunspell dictionary at ${path.join(config.hunspellDir, config.hunspellName)}.{aff,dic}`
    : "spellchecker.lu Hunspell dictionary (npm dictionary-lb; © Michel Weimerskirch et al., EUPL-1.1)";
}

export interface SpellIssue {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

const isAcronym = (w: string) => w.length >= 2 && w.length <= 6 && w === w.toUpperCase() && /\p{Lu}/u.test(w);

function matchCase(original: string, suggestion: string): string {
  const first = original[0];
  const isTitle = first === first.toUpperCase() && original.slice(1) === original.slice(1).toLowerCase();
  if (isTitle && suggestion === suggestion.toUpperCase() && suggestion.length > 1) {
    return suggestion[0] + suggestion.slice(1).toLowerCase();
  }
  if (isTitle && suggestion[0] === suggestion[0].toLowerCase()) {
    return suggestion[0].toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

export function isCorrect(sp: NSpell, word: string): boolean {
  const w = normApostrophe(word);
  if (sp.correct(w)) return true;
  const [, rest] = splitElision(w);
  if (rest !== w && sp.correct(rest)) return true;
  // clitics like 't / 's and trailing apostrophe elisions (ma', ech')
  if (/^'[ts]$/i.test(w)) return true;
  const trimmed = rest.replace(/^'+|'+$/g, "");
  if (trimmed !== rest && trimmed && sp.correct(trimmed)) return true;
  // hyphenated compounds: accept if every part is a word (Hunspell BREAK -)
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every((p) => sp.correct(p) || isAcronym(p) || /^\d+$/.test(p))) return true;
  }
  return false;
}

export function suggest(sp: NSpell, word: string, max: number): string[] {
  const [prefix, rest] = splitElision(word);
  const core = rest.replace(/^'+|'+$/g, "");
  const out: string[] = [];
  for (const s of sp.suggest(core)) {
    const fixed = prefix + matchCase(core, s);
    if (!out.includes(fixed)) out.push(fixed);
    if (out.length >= max) break;
  }
  return out;
}

export interface SpellcheckOptions {
  maxSuggestions: number;
  ignore: Set<string>;
  skipAcronyms: boolean;
  skipCapitalized: boolean;
}

export async function spellcheck(textIn: string, opts: SpellcheckOptions): Promise<{ issues: SpellIssue[]; wordCount: number }> {
  const sp = await getSpeller();
  const issues: SpellIssue[] = [];
  const suggestionCache = new Map<string, string[]>();
  let wordCount = 0;
  const tokens = tokenize(textIn);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "word") continue;
    wordCount++;
    const w = t.text;
    if (opts.ignore.has(w.toLowerCase())) continue;
    if (opts.skipAcronyms && isAcronym(w)) continue;
    if (opts.skipCapitalized && /^\p{Lu}/u.test(w) && !isSentenceStart(tokens, i)) {
      // proper names: only skip when not at sentence start (nouns are capitalised too, so this is opt-in)
      continue;
    }
    if (isCorrect(sp, w)) continue;
    let sugg = suggestionCache.get(w);
    if (!sugg) {
      sugg = suggest(sp, w, opts.maxSuggestions);
      suggestionCache.set(w, sugg);
    }
    issues.push({ word: w, start: t.start, end: t.end, suggestions: sugg });
  }
  return { issues, wordCount };
}

function isSentenceStart(tokens: ReturnType<typeof tokenize>, i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type === "space") continue;
    return t.type === "punct" && /[.!?…:]/.test(t.text);
  }
  return true;
}
