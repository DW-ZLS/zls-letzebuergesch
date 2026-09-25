/**
 * Editable language resources maintained by ZLS in /resources:
 *   grammar-notes.md  — writing rules shown to the AI
 *   germanisms.tsv    — German → Luxembourgish corrections
 * Read once at start-up (restart / redeploy to pick up edits).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resourcesDir(): string {
  if (process.env.ZLS_RESOURCES_DIR) return process.env.ZLS_RESOURCES_DIR;
  // works from src/grammar (tests) and dist/grammar (build): both are two levels below the repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "resources");
}

function read(name: string): string {
  try {
    return fs.readFileSync(path.join(resourcesDir(), name), "utf8");
  } catch {
    return "";
  }
}

let notesCache: string | null = null;
export function grammarNotes(): string {
  if (notesCache === null) {
    notesCache = read("grammar-notes.md")
      .replace(/<!--[\s\S]*?-->/g, "") // drop editor comments
      .trim();
  }
  return notesCache || "(grammar-notes.md not found)";
}

export interface GermanismEntry {
  german: string;
  lb: string;
  note?: string;
}

let germanismCache: Map<string, GermanismEntry> | null = null;

export function parseGermanisms(tsv: string): Map<string, GermanismEntry> {
  const map = new Map<string, GermanismEntry>();
  for (const raw of tsv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [german, lb, note] = line.split("\t").map((s) => s?.trim());
    if (!german || !lb) continue;
    map.set(german.toLowerCase(), { german, lb, note: note || undefined });
  }
  return map;
}

export function germanisms(): Map<string, GermanismEntry> {
  germanismCache ??= parseGermanisms(read("germanisms.tsv"));
  return germanismCache;
}
