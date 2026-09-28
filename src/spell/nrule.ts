/**
 * n-rule (Eifeler Regel) checker, implemented after the official rules:
 * D'Lëtzebuerger Orthografie (CPLL/ZLS 2019, 6th printing 2024), chapter 6.
 *
 *  §6.1.1   final -n/-nn is written only before a vowel, d, h, n, t, z (as pronounced!) and
 *           dropped before other consonants; numbers, abbreviations, y, English/French words
 *           count by pronunciation (de 5. Abrëll / den 1. Abrëll, den LCTO, en Job, de Journal).
 *  §6.1.2.2 nouns/adjectives keep their n unless they end in -en; -äin and one-syllable -een
 *           nouns are optional; exceptions fein, schéin, zwéin follow the rule.
 *  §6.1.2.4 before punctuation (. , ; : ! ? ( ) – / …) the n always stays.
 *  §6.1.2.5 inside hyphenated compounds the rule applies with the following element.
 *  §6.1.2.6 quotation marks are transparent (the rule applies to the next word).
 *  §6.2.1   before si, se, säin, seng…, sech, sou the n is optional.
 *  §6.3     names of persons and brands keep their n.
 *
 * Which words are affected is lexical: we use a list of function words, the unstressed -en
 * ending (checked against Hunspell), and optionally LOD's `nRuleForm`. Each finding cites the rule.
 */
import { normApostrophe, tokenize, type Token } from "./tokenize.js";

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
  rule: string;
  lodConfirmed?: boolean;
}

/* ---------------------------------------------------------------- */
/* 1. What does the next sound require?                              */
/* ---------------------------------------------------------------- */

export type NextContext = "keep" | "drop" | "optional" | "unknown";
export interface Ctx {
  ctx: NextContext;
  rule: string;
  why: string;
}

const VOWELS = "aeiouäëéèêîïôöüûàâáíóúœæ";
const KEEP_CONS = "dhntz";

// Letter names (for abbreviations read letter by letter, §6.1.1 / §8.5.1)
const LETTER_KEEPS: Record<string, boolean> = {
  a: true, b: false, c: true /* zee */, d: true, e: true, f: true /* eff */, g: false, h: true /* ha */,
  i: true, j: false, k: false, l: true, m: true, n: true, o: true, p: false, q: false, r: true, s: true,
  t: true, u: true, v: false, w: false, x: true, y: true, z: true,
};

// English/French words pronounced with an initial [dʒ]/[tʃ] although written with j/ch (§6.1.1)
const DJ_WORDS = /^(job|jobs|jobb|jeans|jazz|jeep|jet|jets|joker|joint|joystick|juice|junk|jumbo|james|john|jack(?!ett)|jam|jingle|junior|jury|jogg|jingle|gin|gentleman|gym)/i;
const TSCH_WORDS = /^(charter|chat|check|chip|chips|champion|challenge|chart|cheese|chill|chips|chopper|church|coach)/i;
// English words starting with a [w]/[j] sound although written o/u (§6.1.1: n can be dropped)
const WJ_WORDS = /^(one|once|use|user|usa\b|unicef|uni(?:form|on|t|versal|verse)\b)/i;

/** How is the number read? Returns true if the spoken form starts with a vowel or d/h/n/t/z. */
export function numberKeepsN(raw: string): boolean | null {
  const ordinal = /\.$/.test(raw);
  const n = Number.parseInt(raw.replace(/[.\s']/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  // spoken initials: 1 eent/éischt, 2 zwee, 3 dräi, 4 véier, 5 fënnef, 6 sechs, 7 siwen, 8 aacht, 9 néng
  const unit: Record<number, boolean> = { 0: true /* null → n */, 1: true, 2: true, 3: true, 4: false, 5: false, 6: false, 7: false, 8: true, 9: true };
  if (n < 10) return unit[n];
  if (n < 20) {
    // 10 zéng, 11 eelef, 12 zwielef, 13 dräizéng, 14 véierzéng, 15 fofzéng, 16 siechzéng, 17 siwwenzéng, 18 uechtzéng, 19 nonzéng
    const teen: Record<number, boolean> = { 10: true, 11: true, 12: true, 13: true, 14: false, 15: false, 16: false, 17: false, 18: true, 19: true };
    return teen[n];
  }
  if (n < 100) {
    const u = n % 10;
    if (u !== 0) return unit[u] ?? null; // 21 = eenanzwanzeg, 25 = fënnefanzwanzeg
    // 20 zwanzeg, 30 drësseg, 40 véierzeg, 50 fofzeg, 60 sechzeg, 70 siwwenzeg, 80 achtzeg, 90 nonzeg
    const tens: Record<number, boolean> = { 20: true, 30: true, 40: false, 50: false, 60: false, 70: false, 80: true, 90: true };
    return tens[n];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    return h === 1 ? true /* honnert */ : unit[h];
  }
  if (n < 1_000_000) {
    const t = Math.floor(n / 1000);
    return t === 1 ? true /* dausend */ : numberKeepsN(String(t));
  }
  void ordinal;
  return null;
}

const OPTIONAL_NEXT = /^(si|se|säin|seng|senger|sengem|sengen|sengt|sech|sou)$/i;
const PAUSE = new Set([".", ",", ";", ":", "!", "?", "…", "(", ")", "[", "]", "–", "—", "/"]);
const QUOTES = new Set(["„", "“", "”", "\"", "«", "»", "‚", "‘", "’", "'", "‹", "›"]);

/** Decide what the token(s) after position i require. `tokens` include spaces. */
export function contextAfter(tokens: Token[], i: number, endIsPause = true): Ctx & { next?: Token; quoted: boolean } {
  let j = i + 1;
  let quoted = false;
  for (; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "space") continue;
    if (t.type === "punct" && QUOTES.has(t.text)) {
      // an opening quote in front of the next word is transparent (§6.1.2.6); a closing quote is skipped too
      quoted = true;
      continue;
    }
    break;
  }
  const next = tokens[j];
  if (!next) return endIsPause ? { ctx: "keep", rule: "6.1.2.4", why: "end of text", quoted } : { ctx: "unknown", rule: "6.1.1", why: "", quoted };
  if (next.type === "punct") {
    if (PAUSE.has(next.text)) return { ctx: "keep", rule: "6.1.2.4", why: `before “${next.text}”`, next, quoted };
    if (next.text === "-") return { ctx: "unknown", rule: "6.1.2.5", why: "", next, quoted };
    return { ctx: "unknown", rule: "6.1.1", why: "", next, quoted };
  }
  if (next.type === "number") {
    const k = numberKeepsN(next.text);
    if (k === null) return { ctx: "unknown", rule: "6.1.1", why: "", next, quoted };
    return { ctx: k ? "keep" : "drop", rule: "6.1.1", why: `“${next.text}” is read with ${k ? "a vowel or d/h/n/t/z" : "another consonant"}`, next, quoted };
  }
  return { ...wordContext(next.text), next, quoted };
}

export function wordContext(raw: string): Ctx {
  let w = normApostrophe(raw);
  // clitics/elisions: d'Haus → d, z'iessen → z, 't → t, 's → s
  if (/^'[a-z]/i.test(w)) w = w.slice(1);
  if (!w) return { ctx: "unknown", rule: "6.1.1", why: "" };
  if (OPTIONAL_NEXT.test(w)) return { ctx: "optional", rule: "6.2.1", why: `n is optional before “${w}”` };
  // the linking s of subordinate clauses ("wann s de …", §4.4.1) does not trigger the rule
  if (raw === "s") return { ctx: "optional", rule: "4.4.1", why: "linking s" };
  // single letters (and letter + digits: F91) are read by their name (§6.1.1, §8.4)
  if (/^\p{L}(?:\d+)?$/u.test(w)) {
    const keeps = LETTER_KEEPS[w[0].toLowerCase()];
    if (keeps !== undefined) return { ctx: keeps ? "keep" : "drop", rule: "6.1.1", why: `letter “${w[0]}” is read by its name` };
  }
  const first = w[0];
  const c = first.toLowerCase();
  // abbreviations read letter by letter (all caps, 2–6 letters, possibly with hyphen/digits after)
  const abbr = /^([A-ZÄËÉÖÜ]{2,6})(?:$|[-0-9]|[a-z]{1,2}$)/.exec(w);
  if (abbr) {
    const keeps = LETTER_KEEPS[abbr[1][0].toLowerCase()];
    return keeps === undefined ? { ctx: "unknown", rule: "6.1.1", why: "" }
      : { ctx: keeps ? "keep" : "drop", rule: "6.1.1", why: `abbreviation read letter by letter (“${abbr[1][0]}” …)` };
  }
  if (c === "y") return { ctx: "unknown", rule: "6.1.1", why: "y: depends on pronunciation" };
  if (VOWELS.includes(c)) {
    if (WJ_WORDS.test(w)) return { ctx: "optional", rule: "6.1.1", why: "English word pronounced with [w]/[j]" };
    return { ctx: "keep", rule: "6.1.1", why: "before a vowel" };
  }
  if (KEEP_CONS.includes(c)) return { ctx: "keep", rule: "6.1.1", why: `before “${c}”` };
  if (c === "j") return DJ_WORDS.test(w) ? { ctx: "keep", rule: "6.1.1", why: "pronounced [dʒ]" } : { ctx: "drop", rule: "6.1.1", why: "before “j”" };
  if (c === "c") {
    if (/^ch/i.test(w)) return TSCH_WORDS.test(w) ? { ctx: "keep", rule: "6.1.1", why: "pronounced [tʃ]" } : { ctx: "drop", rule: "6.1.1", why: "before “ch”" };
    if (/^c[eiyéè]/i.test(w)) return { ctx: "optional", rule: "6.1.1", why: "c read as [s] or [ts]" };
    return { ctx: "drop", rule: "6.1.1", why: "c read as [k]" };
  }
  if (c === "g" && /^g(entleman|in\b|ym)/i.test(w)) return { ctx: "keep", rule: "6.1.1", why: "pronounced [dʒ]" };
  if (/\p{L}/u.test(c)) return { ctx: "drop", rule: "6.1.1", why: `before “${c}”` };
  return { ctx: "unknown", rule: "6.1.1", why: "" };
}

/** Backwards-compatible helper (used by the grammar checks for n-rule-aware suggestions). */
export function contextOf(next: Token | undefined): "keep" | "drop" | "unknown" {
  if (!next) return "keep";
  if (next.type === "punct") return PAUSE.has(next.text) ? "keep" : "unknown";
  if (next.type === "number") {
    const k = numberKeepsN(next.text);
    return k === null ? "unknown" : k ? "keep" : "drop";
  }
  const c = wordContext(next.text).ctx;
  return c === "optional" ? "unknown" : c;
}

/* ---------------------------------------------------------------- */
/* 2. Which words are subject to the rule?                           */
/* ---------------------------------------------------------------- */

/** Function words and verb forms (not nouns/adjectives) with their n-less form. */
const FUNCTION_PAIRS: Array<[string, string]> = [
  ["den", "de"], ["en", "e"], ["een", "ee"], ["keen", "kee"], ["deen", "dee"], ["wien", "wie"], ["hien", "hie"],
  ["mäin", "mäi"], ["däin", "däi"], ["säin", "säi"], ["an", "a"], ["un", "u"], ["vun", "vu"], ["wann", "wa"],
  ["dann", "da"], ["hunn", "hu"], ["ginn", "gi"], ["sinn", "si"], ["kann", "ka"], ["schonn", "scho"],
  ["geschwënn", "geschwë"], ["jiddereen", "jidderee"], ["iergendeen", "iergendee"], ["gesinn", "gesi"],
  ["stinn", "sti"], ["dinn", "di"], ["eisen", "eise"], ["ären", "äre"], ["hiren", "hire"], ["iren", "ire"],
  ["mengen", "menge"], ["dengen", "denge"], ["sengen", "senge"], ["dësen", "dëse"], ["kengen", "kenge"],
  ["dën", "dë"], ["fein", "fei"], ["schéin", "schéi"], ["zwéin", "zwéi"], ["nun", "nu"], ["hin", "hi"],
];
const WITH_N = new Map(FUNCTION_PAIRS.map(([n, b]) => [n, b]));

/** n-less forms that are unambiguous (never a word of their own in the position checked). */
const REVERSE_SAFE: Record<string, { withN: string; conf: Confidence }> = {
  a: { withN: "an", conf: "high" }, u: { withN: "un", conf: "high" }, vu: { withN: "vun", conf: "high" },
  hie: { withN: "hien", conf: "high" }, wa: { withN: "wann", conf: "high" }, da: { withN: "dann", conf: "medium" },
  hu: { withN: "hunn", conf: "high" }, gi: { withN: "ginn", conf: "high" }, ka: { withN: "kann", conf: "high" },
  scho: { withN: "schonn", conf: "high" }, geschwë: { withN: "geschwënn", conf: "high" },
  ee: { withN: "een", conf: "medium" }, kee: { withN: "keen", conf: "high" }, dee: { withN: "deen", conf: "medium" },
  wie: { withN: "wien", conf: "high" }, mäi: { withN: "mäin", conf: "high" }, däi: { withN: "däin", conf: "high" },
  säi: { withN: "säin", conf: "high" }, schéi: { withN: "schéin", conf: "medium" }, fei: { withN: "fein", conf: "medium" },
  jidderee: { withN: "jiddereen", conf: "high" }, iergendee: { withN: "iergendeen", conf: "high" },
  de: { withN: "den", conf: "medium" }, e: { withN: "en", conf: "medium" },
};

/** Words ending in -en that are NOT subject to the rule (stressed -en, names…). */
const EN_EXCEPTIONS = new Set(["examen", "pollen", "amen", "ren", "den", "en"]);

export interface NRuleDeps {
  /** Is this a valid Luxembourgish word form? (Hunspell) */
  isWord: (w: string) => boolean;
  /** Optional: LOD nRuleForm of the lemma equal to `w` (null = lemma exists without one, undefined = unknown). */
  lodNRuleForm?: (w: string) => Promise<string | null | undefined>;
  lodBudget?: number;
  /** Treat end of text as a pause (default true). Set false for fragments. */
  endIsPause?: boolean;
}

function likeCase(model: string, s: string): string {
  if (model.length > 1 && model === model.toUpperCase()) return s.toUpperCase();
  if (model[0] === model[0].toUpperCase()) return s[0].toUpperCase() + s.slice(1);
  return s;
}

const isCap = (s: string) => /^\p{Lu}/u.test(s);

function sentenceInitial(tokens: Token[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type === "space") continue;
    if (t.type === "punct" && QUOTES.has(t.text)) continue;
    return t.type === "punct" && /[.!?…:]/.test(t.text);
  }
  return true;
}

function prevWord(tokens: Token[], i: number): Token | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type === "space") continue;
    return t.type === "word" ? t : undefined;
  }
  return undefined;
}

type Subject = { bare: string; conf: Confidence; reason: string; rule: string } | { optional: true; rule: string } | null;

/** Is `word` (ending in n) subject to the rule, and what is its n-less form? */
function subjectOf(word: string, tokens: Token[], i: number, deps: NRuleDeps): Subject {
  const lower = word.toLocaleLowerCase("lb");
  const cap = isCap(word) && !sentenceInitial(tokens, i);
  const prev = prevWord(tokens, i);
  if (prev && /^(zu)$/i.test(prev.text) && cap) return { optional: true, rule: "6.4" }; // zu Lëntgen / zu Lëntge
  const listed = WITH_N.get(lower);
  if (listed) {
    if (cap) return { optional: true, rule: "6.3" }; // capitalised mid-sentence → a name (Wien, Hien…)
    return { bare: likeCase(word, listed), conf: "high", reason: "word subject to the n-rule", rule: "6.1.1" };
  }
  if (/äin$/.test(lower)) return { optional: true, rule: "6.1.2.2" }; // Wäin/Wäi, Schwäin/Schwäi
  if (cap && /een$/.test(lower)) return { optional: true, rule: "6.1.2.2" }; // Been/Bee, Steen/Stee
  if (/[^e]en$/.test(lower) && lower.length >= 4 && !EN_EXCEPTIONS.has(lower)) {
    // Capitalised words that are not in the dictionary are probably names → keep n (§6.3)
    if (cap && !deps.isWord(word)) return { optional: true, rule: "6.3" };
    const bare = word.slice(0, -1);
    if (deps.isWord(bare)) {
      // capitalised mid-sentence: could be a name or a place (§6.3, §6.4) → low
      return { bare, conf: cap ? "low" : "medium", reason: cap ? "unstressed -en ending (unless this is a name)" : "unstressed -en ending", rule: "6.1.1" };
    }
    return null;
  }
  // other nouns and adjectives keep their n (§6.1.2.2): Mann, Frënn, blann, Loun …
  return null;
}

/* ---------------------------------------------------------------- */
/* 3. Main check                                                     */
/* ---------------------------------------------------------------- */

export async function checkNRule(text: string, deps: NRuleDeps): Promise<NRuleIssue[]> {
  const tokens = tokenize(text);
  const issues: NRuleIssue[] = [];
  let budget = deps.lodBudget ?? 15;
  const endIsPause = deps.endIsPause ?? true;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "word") continue;
    const word = normApostrophe(t.text);

    // hyphenated compounds: apply the rule between the parts (§6.1.2.5)
    if (word.includes("-") && !/^-|-$/.test(word)) {
      checkCompound(t, word, deps, issues);
    }

    const prefix = /^[dDzZ]'/.exec(word)?.[0] ?? "";
    const bare = word.slice(prefix.length).split("-").pop() ?? "";
    if (!bare || /'$/.test(bare) || /^'/.test(bare)) continue;
    if (i > 0 && tokens[i - 1].text === "#") continue; // hashtags (§6.2.2)
    const lower = bare.toLocaleLowerCase("lb");
    const c = contextAfter(tokens, i, endIsPause);
    if (c.ctx === "unknown" || c.ctx === "optional") continue;
    const nextWord = c.next ? c.next.text : "(end)";
    const quotedLow = c.quoted;

    if (c.ctx === "drop" && /n$/.test(lower)) {
      if (word.includes("-")) continue; // handled by the compound check / next element
      const s = subjectOf(bare, tokens, i, deps);
      if (s && "optional" in s) continue;
      let suggestion = s ? s.bare : undefined;
      let confidence: Confidence | undefined = s ? s.conf : undefined;
      let reason = s ? s.reason : "";
      let rule = s ? s.rule : "6.1.1";
      let lodConfirmed = false;
      if (deps.lodNRuleForm && budget > 0 && confidence !== "high" && !(isCap(bare) && !sentenceInitial(tokens, i) && !/en$/.test(lower))) {
        budget--;
        const form = await deps.lodNRuleForm(bare);
        if (form) {
          suggestion = likeCase(bare, form);
          confidence = "high";
          reason = "LOD gives this n-rule form";
          lodConfirmed = true;
        } else if (form === null && confidence === "medium") {
          confidence = "low";
          reason += "; LOD lists no n-rule form for this lemma";
        }
      }
      if (!suggestion || !confidence) continue;
      if (quotedLow) confidence = "low"; // words in quotes may keep their n (§6.1.2.6)
      issues.push({
        word, start: t.start, end: t.end, suggestion: prefix + suggestion, nextWord, direction: "drop-n", confidence,
        reason: `${reason}; ${c.why}`, rule, ...(lodConfirmed ? { lodConfirmed } : {}),
      });
    } else if (c.ctx === "keep" && !/n$/.test(lower)) {
      if (word.includes("-")) continue;
      const pause = c.rule === "6.1.2.4";
      const prev = prevWord(tokens, i);
      // the unstressed pronoun "de" (= du) after a 2nd-person verb is not an article: "hues de", "ob s de"
      if (lower === "de" && prev && /(s|st|z|x)$/i.test(prev.text)) continue;
      // "e" as unstressed pronoun after verbs/conjunctions ("wat e(n) si …") is optional
      if (lower === "e" && pause) continue;
      const listed = REVERSE_SAFE[lower];
      let conf: Confidence | undefined;
      let withN: string | undefined;
      let reason = "";
      if (listed) {
        conf = listed.conf;
        withN = listed.withN;
        reason = pause ? "n stays before punctuation" : "n stays before a vowel or d, h, n, t, z";
        if (pause && !/^(hu|gi|ka|scho|geschwë|hie|wie|kee)$/.test(lower)) conf = "low";
        // article "de"/"e" before a lowercase word that is not an adjective of a noun phrase (e.g. French "Eau de toilette")
        if ((lower === "de" || lower === "e") && c.next && /^\p{Ll}/u.test(c.next.text)) conf = "low";
      } else if (/[^e]e$/.test(lower) && lower.length >= 4 && (!isCap(bare) || pause) && deps.isWord(bare + "n")) {
        // French loans with a mute -e (beige, large, orange, louche, fatale) are not n-rule forms
        // capitalised singular nouns often end in -e (Regie, Galerie, Dame) → only low for nouns
        conf = pause && !isCap(bare) && !/(ge|che|ce|le|re|se|te|ne|ie|ue|ée|de)$/.test(lower) ? "medium" : "low";
        withN = bare + "n";
        reason = pause ? "n stays before punctuation" : "possible n-rule form of an -en word";
        if (deps.lodNRuleForm && budget > 0) {
          budget--;
          const form = await deps.lodNRuleForm(bare + "n");
          if (form && form.toLocaleLowerCase("lb") === lower) {
            conf = "high";
            reason = "LOD gives this as the n-rule form; the n must stay here";
          }
        }
      }
      if (!conf || !withN) continue;
      if (quotedLow) conf = "low";
      issues.push({
        word, start: t.start, end: t.end, suggestion: prefix + likeCase(bare, withN), nextWord, direction: "add-n", confidence: conf,
        reason: `${reason}; ${c.why}`, rule: pause ? "6.1.2.4" : "6.1.1",
      });
    }
  }
  return issues;
}

/** n-rule between the elements of a hyphenated compound (§6.1.2.5): en Zwee-Phase-Modell, Vun-der-Hand-an-de-Mond-Liewe */
function checkCompound(t: Token, word: string, deps: NRuleDeps, issues: NRuleIssue[]) {
  const parts = word.split("-");
  let offset = 0;
  for (let k = 0; k < parts.length - 1; k++) {
    const part = parts[k];
    const next = parts[k + 1];
    const start = t.start + offset;
    offset += part.length + 1;
    if (!part || !next) continue;
    const lower = part.toLocaleLowerCase("lb");
    const ctx = wordContext(next).ctx;
    if (ctx !== "drop" || !/n$/.test(lower)) continue;
    // only clear cases: listed function words and plural/verb -en elements
    const listed = WITH_N.get(lower);
    let bare: string | undefined = listed ? likeCase(part, listed) : undefined;
    if (!bare && /[^e]en$/.test(lower) && !(k > 0 && isCap(part) && !deps.isWord(part)) && deps.isWord(part) && deps.isWord(part.slice(0, -1))) bare = part.slice(0, -1);
    if (!bare) continue;
    issues.push({
      word: part, start, end: start + part.length, suggestion: bare, nextWord: next, direction: "drop-n",
      confidence: "medium", reason: "inside a hyphenated compound the n-rule applies with the next element", rule: "6.1.2.5",
    });
  }
}
