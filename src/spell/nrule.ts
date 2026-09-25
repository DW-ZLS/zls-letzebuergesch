/**
 * Eifeler Regel (n-rule) checker — HEURISTIC.
 *
 * Rule (ZLS orthography): a final -n / -nn is kept before a word starting with
 * a vowel or with n, d, t, z, h, and before a pause (punctuation, end of text);
 * it is dropped before every other consonant.
 *   "den Apel", "den Hond", "de Mann"; "mir maachen dat", "mir maache Kaffi".
 *
 * Which words are subject to the rule cannot be decided from spelling alone.
 * We combine: (1) a curated list of frequent function words with known pairs,
 * (2) the generic unstressed -en ending validated against the Hunspell word list,
 * (3) optionally LOD's `nRuleForm` field to confirm or reject a candidate.
 * Every finding carries a confidence so a reviewer can triage.
 *
 * ZLS's in-house EifelerRegel module (spellchecker.lu, rules.xml) is the
 * reference implementation; this module is designed to be swappable for it.
 */
import { PAUSE_PUNCT, normApostrophe, tokenize, type Token } from "./tokenize.js";

export type Confidence = "high" | "medium" | "low";

export interface NRuleIssue {
  word: string;
  start: number;
  end: number;
  suggestion: string;
  nextWord: string;
  direction: "drop-n" | "add-n";
  confidence: Confidence;
  reason: string;
  lodConfirmed?: boolean;
}

/** Word with n → n-less form, plus how reliable the reverse ("add n") check is. */
const PAIRS: Array<[withN: string, withoutN: string, reverse: Confidence | null]> = [
  ["den", "de", "medium"], // "de" is also the unstressed 2nd-person pronoun (du)
  ["en", "e", "medium"], // "e" is also the unstressed pronoun (hien)
  ["een", "ee", "high"],
  ["keen", "kee", "high"],
  ["deen", "dee", "high"],
  ["wien", "wie", "high"],
  ["hien", "hie", "high"],
  ["mäin", "mäi", "high"],
  ["däin", "däi", "high"],
  ["säin", "säi", "high"],
  ["an", "a", "high"],
  ["un", "u", "high"],
  ["vun", "vu", "high"],
  ["wann", "wa", "high"],
  ["dann", "da", "high"],
  ["hunn", "hu", "high"],
  ["ginn", "gi", "high"],
  ["sinn", "si", null], // "si" is also the pronoun → never suggest adding n
  ["schéin", "schéi", "high"],
  ["jidderee", "jidderee", null],
  ["jiddereen", "jidderee", "high"],
  ["eisen", "eise", "medium"],
  ["ären", "äre", "medium"],
  ["hiren", "hire", "medium"],
  ["iren", "ire", "medium"],
  ["mengen", "menge", "medium"],
  ["dengen", "denge", "medium"],
  ["sengen", "senge", "medium"],
  ["dësen", "dëse", "medium"],
  ["Wäin", "Wäi", "high"],
  ["Schwäin", "Schwäi", "high"],
  ["Been", "Bee", "medium"],
  ["Steen", "Stee", "medium"],
].filter(([a, b]) => a !== b) as Array<[string, string, Confidence | null]>;

const WITH_N = new Map(PAIRS.map(([n, bare]) => [n.toLowerCase(), bare]));
const WITHOUT_N = new Map(
  PAIRS.filter(([, , rev]) => rev !== null).map(([n, bare, rev]) => [bare.toLowerCase(), { withN: n, conf: rev as Confidence }]),
);

const VOWELS = "aeiouäëéèêîïôöüûàâáíóú";
const KEEP_CONSONANTS = "ndtzh";

export type NextContext = "keep" | "drop" | "unknown";

/** Decide what the following token requires. */
export function contextOf(next: Token | undefined): NextContext {
  if (!next) return "keep"; // end of text = pause
  if (next.type === "punct") return PAUSE_PUNCT.has(next.text) ? "keep" : "unknown";
  if (next.type === "number") return "unknown"; // depends on how the number is read
  const w = normApostrophe(next.text).replace(/^'/, "");
  if (!w) return "unknown";
  if (w.length >= 2 && w.length <= 6 && w === w.toUpperCase()) return "unknown"; // acronym, read letter by letter
  const c = w[0].toLowerCase();
  if (c === "y") return "unknown";
  if (VOWELS.includes(c) || KEEP_CONSONANTS.includes(c)) return "keep";
  return /\p{L}/u.test(c) ? "drop" : "unknown";
}

function nextNonSpace(tokens: Token[], i: number): Token | undefined {
  for (let j = i + 1; j < tokens.length; j++) if (tokens[j].type !== "space") return tokens[j];
  return undefined;
}

/** Apply the capitalisation of `model` to `s`. */
function likeCase(model: string, s: string): string {
  if (model === model.toUpperCase() && model.length > 1) return s.toUpperCase();
  if (model[0] === model[0].toUpperCase()) return s[0].toUpperCase() + s.slice(1);
  return s;
}

export interface NRuleDeps {
  /** Is this a valid Luxembourgish word form? (Hunspell) */
  isWord: (w: string) => boolean;
  /** Optional: LOD nRuleForm of the lemma equal to `w` (null = lemma exists without n-rule form, undefined = unknown). */
  lodNRuleForm?: (w: string) => Promise<string | null | undefined>;
  lodBudget?: number;
}

export async function checkNRule(text: string, deps: NRuleDeps): Promise<NRuleIssue[]> {
  const tokens = tokenize(text);
  const issues: NRuleIssue[] = [];
  let budget = deps.lodBudget ?? 15;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "word") continue;
    const word = normApostrophe(t.text);
    // "d'Kanner" etc.: the elided prefix is irrelevant for the ending
    const bare = word.replace(/^[dDzZ]'/, "");
    const lower = bare.toLowerCase();
    if (lower.length < 1 || /['-]$/.test(bare)) continue;
    const next = nextNonSpace(tokens, i);
    const ctx = contextOf(next);
    if (ctx === "unknown") continue;
    const nextWord = next ? next.text : "(end)";

    if (ctx === "drop" && /n$/.test(lower)) {
      // ---- final n where it should be dropped ----
      let suggestion: string | undefined;
      let confidence: Confidence | undefined;
      let reason = "";
      const listed = WITH_N.get(lower);
      if (listed) {
        suggestion = likeCase(bare, listed);
        confidence = "high";
        reason = "function word subject to the n-rule";
      } else if (/[^e]en$/.test(lower) && lower.length >= 4 && deps.isWord(bare.slice(0, -1))) {
        suggestion = bare.slice(0, -1);
        confidence = "medium";
        reason = "unstressed -en ending (infinitive, plural, inflected adjective …)";
      }
      if (deps.lodNRuleForm && budget > 0 && (confidence !== "high" || !suggestion)) {
        budget--;
        const form = await deps.lodNRuleForm(bare);
        if (form) {
          suggestion = likeCase(bare, form);
          confidence = "high";
          reason = "LOD lists an n-rule form for this word";
          issues.push(mk(t, word, prefixOf(word) + suggestion, nextWord, "drop-n", confidence, reason, true));
          continue;
        }
        if (form === null && confidence === "medium") {
          // LOD knows this exact lemma and gives no n-rule form → probably not subject
          confidence = "low";
          reason += "; LOD lists no n-rule form for this lemma";
        }
      }
      if (suggestion && confidence) issues.push(mk(t, word, prefixOf(word) + suggestion, nextWord, "drop-n", confidence, reason));
    } else if (ctx === "keep" && !/n$/.test(lower)) {
      // ---- n missing where it must be kept ----
      const pauseContext = !next || next.type === "punct";
      const listed = WITHOUT_N.get(lower);
      if (listed) {
        let conf: Confidence = listed.conf;
        if (pauseContext) conf = conf === "high" ? "medium" : "low";
        issues.push(
          mk(t, word, prefixOf(word) + likeCase(bare, listed.withN), nextWord, "add-n", conf,
            pauseContext ? "n is kept before a pause" : "n is kept before vowels and n, d, t, z, h"),
        );
        continue;
      }
      if (!pauseContext && /[^e]e$/.test(lower) && lower.length >= 4 && deps.isWord(bare + "n")) {
        let conf: Confidence = "low";
        let reason = "possible n-rule form of an -en word before a vowel/n/d/t/z/h";
        let confirmed: boolean | undefined;
        if (deps.lodNRuleForm && budget > 0) {
          budget--;
          const form = await deps.lodNRuleForm(bare + "n");
          if (form && form.toLowerCase() === lower) {
            conf = "high";
            reason = "LOD gives this as the n-rule form; keep the n here";
            confirmed = true;
          }
        }
        issues.push(mk(t, word, prefixOf(word) + bare + "n", nextWord, "add-n", conf, reason, confirmed));
      }
    }
  }
  return issues;
}

const prefixOf = (w: string) => /^[dDzZ]'/.exec(w)?.[0] ?? "";

function mk(
  t: Token,
  word: string,
  suggestion: string,
  nextWord: string,
  direction: NRuleIssue["direction"],
  confidence: Confidence,
  reason: string,
  lodConfirmed?: boolean,
): NRuleIssue {
  return { word, start: t.start, end: t.end, suggestion, nextWord, direction, confidence, reason, ...(lodConfirmed ? { lodConfirmed } : {}) };
}
