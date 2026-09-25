/**
 * Loader for the Méisproochegen Iwwersetzungskorpus fir d'Lëtzebuergescht
 * (ZLS, CC0, data.public.lu). Accepts the published ZIP or a bare TMX / JSONL
 * file, from a local path or a URL (downloaded once into the cache directory).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { config } from "../config.js";

export type CorpusLang = "lb" | "fr" | "de" | "en";
export const CORPUS_LANGS: readonly CorpusLang[] = ["lb", "fr", "de", "en"];

export interface Segment {
  id: number;
  text: Partial<Record<CorpusLang, string>>;
  meta?: Record<string, string>;
}

export interface Corpus {
  segments: Segment[];
  source: string;
  files: string[];
  counts: Record<CorpusLang, number>;
}

/* ---------------------------------------------------------------- */
/* Language code normalisation                                       */
/* ---------------------------------------------------------------- */

const LANG_ALIASES: Record<string, CorpusLang> = {
  lb: "lb", lu: "lb", ltz: "lb", lux: "lb", luxembourgish: "lb", "lëtzebuergesch": "lb", letzebuergesch: "lb", luxemburgisch: "lb",
  fr: "fr", fra: "fr", fre: "fr", french: "fr", "français": "fr", francais: "fr", franzoesch: "fr", "franséisch": "fr",
  de: "de", deu: "de", ger: "de", german: "de", deutsch: "de", "däitsch": "de",
  en: "en", eng: "en", english: "en", englesch: "en",
};

/** "lb-LU" → lb, "LU" → lb, "fr_FR" → fr, "text_de" → de, "Luxembourgish" → lb */
export function normLang(code: string | undefined): CorpusLang | undefined {
  if (!code) return undefined;
  const c = code.trim().toLowerCase();
  if (LANG_ALIASES[c]) return LANG_ALIASES[c];
  for (const part of c.split(/[-_\s.:/]+/)) if (LANG_ALIASES[part]) return LANG_ALIASES[part];
  return undefined;
}

/* ---------------------------------------------------------------- */
/* TMX                                                               */
/* ---------------------------------------------------------------- */

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Strip TMX inline markup (<bpt>, <ept>, <ph>, <it>, <hi> …) but keep <hi>/<sub> text. */
function cleanSeg(raw: string): string {
  return decodeEntities(
    raw
      .replace(/<(bpt|ept|ph|it)\b[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<(bpt|ept|ph|it)\b[^>]*\/>/g, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTmx(xml: string, startId = 0): Segment[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    stopNodes: ["*.seg"],
    isArray: (name) => name === "tu" || name === "tuv" || name === "prop",
    processEntities: false,
    trimValues: false,
  });
  const doc = parser.parse(xml);
  const tus: any[] = doc?.tmx?.body?.tu ?? [];
  const out: Segment[] = [];
  let id = startId;
  for (const tu of tus) {
    const text: Segment["text"] = {};
    for (const tuv of tu.tuv ?? []) {
      const lang = normLang(tuv["@xml:lang"] ?? tuv["@lang"]);
      if (!lang) continue;
      const segRaw = typeof tuv.seg === "string" ? tuv.seg : tuv.seg?.["#text"] ?? "";
      const s = cleanSeg(String(segRaw));
      if (s) text[lang] = s;
    }
    if (!Object.keys(text).length) continue;
    const meta: Record<string, string> = {};
    for (const p of tu.prop ?? []) {
      const k = p["@type"];
      const v = typeof p === "string" ? p : p["#text"];
      if (k && v) meta[String(k)] = String(v);
    }
    if (tu["@tuid"]) meta.tuid = String(tu["@tuid"]);
    out.push({ id: id++, text, ...(Object.keys(meta).length ? { meta } : {}) });
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* JSONL                                                             */
/* ---------------------------------------------------------------- */

/**
 * Tolerant JSONL reader. Understands, per line:
 *   {"lb": "...", "fr": "...", ...}               (flat, any casing / aliases like "LU", "text_de")
 *   {"translation": {"lb": "...", "de": "..."}}   (Hugging Face style)
 *   {"source": "...", "target": "...", "source_lang": "lb", "target_lang": "fr"}
 */
export function parseJsonl(data: string, startId = 0): Segment[] {
  const out: Segment[] = [];
  let id = startId;
  for (const line of data.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(l);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const text: Segment["text"] = {};
    const meta: Record<string, string> = {};
    const o = obj as Record<string, unknown>;

    const srcLang = normLang(str(o.source_lang ?? o.src_lang ?? o.sourceLanguage));
    const tgtLang = normLang(str(o.target_lang ?? o.tgt_lang ?? o.targetLanguage));
    if (srcLang && str(o.source ?? o.src)) text[srcLang] = str(o.source ?? o.src)!;
    if (tgtLang && str(o.target ?? o.tgt)) text[tgtLang] = str(o.target ?? o.tgt)!;

    const visit = (rec: Record<string, unknown>, depth: number) => {
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "string") {
          const lang = normLang(k);
          if (lang && v.trim()) text[lang] ??= v.trim();
          else if (depth === 0 && v.length < 200) meta[k] = v;
        } else if (typeof v === "number" && depth === 0) {
          meta[k] = String(v);
        } else if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) {
          visit(v as Record<string, unknown>, depth + 1);
        }
      }
    };
    visit(o, 0);
    if (!Object.keys(text).length) continue;
    out.push({ id: id++, text, ...(Object.keys(meta).length ? { meta } : {}) });
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/* ---------------------------------------------------------------- */
/* Files & ZIP                                                       */
/* ---------------------------------------------------------------- */

type Loaded = { segments: Segment[]; files: string[] };

export function parseBuffer(name: string, buf: Uint8Array): Loaded {
  const lower = name.toLowerCase();
  const dec = new TextDecoder("utf-8");
  if (lower.endsWith(".zip")) {
    const entries = unzipSync(buf);
    const names = Object.keys(entries).filter((n) => !n.startsWith("__MACOSX/") && !n.endsWith("/"));
    // The published ZIP carries the same corpus in several formats: use one format only.
    const tmx = names.filter((n) => n.toLowerCase().endsWith(".tmx"));
    const jsonl = names.filter((n) => /\.jsonl?$/i.test(n));
    const pick = tmx.length ? tmx : jsonl;
    const segments: Segment[] = [];
    for (const n of pick.sort()) {
      const sub = parseBuffer(n, entries[n]);
      for (const s of sub.segments) segments.push({ ...s, id: segments.length });
    }
    return { segments, files: pick.map((n) => `${name}:${n}`) };
  }
  const textData = dec.decode(buf).replace(/^﻿/, "");
  if (lower.endsWith(".tmx") || lower.endsWith(".xml")) return { segments: parseTmx(textData), files: [name] };
  if (/\.jsonl?$/.test(lower)) return { segments: parseJsonl(textData), files: [name] };
  throw new Error(`Unsupported corpus file type: ${name} (expected .zip, .tmx or .jsonl)`);
}

async function fetchToCache(url: string): Promise<string> {
  await fs.mkdir(config.cacheDir, { recursive: true });
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const ext = path.extname(new URL(url).pathname) || ".zip";
  const target = path.join(config.cacheDir, `corpus-${hash}${ext}`);
  try {
    await fs.access(target);
    return target;
  } catch {
    /* not cached yet */
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": config.userAgent } });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const tmp = `${target}.part`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, target);
    return target;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadCorpus(): Promise<Corpus> {
  let file = config.corpusPath;
  let source: string;
  if (file) {
    source = file;
  } else {
    source = config.corpusUrl;
    file = await fetchToCache(config.corpusUrl);
  }
  const stat = await fs.stat(file);
  let loaded: Loaded;
  if (stat.isDirectory()) {
    const names = (await fs.readdir(file)).filter((n) => /\.(tmx|jsonl?|zip)$/i.test(n));
    const tmx = names.filter((n) => /\.tmx$/i.test(n));
    const pick = tmx.length ? tmx : names;
    const segments: Segment[] = [];
    for (const n of pick.sort()) {
      const sub = parseBuffer(n, await fs.readFile(path.join(file, n)));
      for (const s of sub.segments) segments.push({ ...s, id: segments.length });
    }
    loaded = { segments, files: pick };
  } else {
    loaded = parseBuffer(path.basename(file), await fs.readFile(file));
  }
  const counts = { lb: 0, fr: 0, de: 0, en: 0 } as Record<CorpusLang, number>;
  for (const s of loaded.segments) for (const l of CORPUS_LANGS) if (s.text[l]) counts[l]++;
  return { segments: loaded.segments, source, files: loaded.files, counts };
}

let corpusPromise: Promise<Corpus> | null = null;

export function getCorpus(): Promise<Corpus> {
  corpusPromise ??= loadCorpus();
  corpusPromise.catch(() => {
    corpusPromise = null;
  });
  return corpusPromise;
}

/** For tests. */
export function setCorpusForTesting(c: Corpus | null) {
  corpusPromise = c ? Promise.resolve(c) : null;
}
