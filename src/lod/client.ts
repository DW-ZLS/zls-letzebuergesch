import { config } from "../config.js";
import { TtlCache } from "../lib/cache.js";
import { getJson, UpstreamError, type FetchLike } from "../lib/http.js";
import { normalizeEntry, normalizeSearchResult } from "./normalize.js";
import type { Entry, LodLang, RawEntryResponse, RawSearchResponse, SearchHit } from "./types.js";

/** LOD article IDs look like HAUS1, MAACHEN1, BEKANNTMAACHEN2, 2-D1 ... */
const ID_RE = /^[A-Z0-9][A-Z0-9_\-]{0,63}$/;

export function isLodId(s: string): boolean {
  return ID_RE.test(s);
}

export class LodClient {
  private searchCache = new TtlCache<SearchHit[]>(config.lodCacheMaxEntries, config.lodCacheTtlMs);
  private entryCache = new TtlCache<Entry | null>(config.lodCacheMaxEntries, config.lodCacheTtlMs);

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base: string = config.lodApiBase,
  ) {}

  async search(query: string, lang: LodLang = "lb"): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const key = `${lang}\u0000${q.toLowerCase()}`;
    const cached = this.searchCache.get(key);
    if (cached) return cached;
    const url = `${this.base}/search?query=${encodeURIComponent(q)}&lang=${lang}`;
    const raw = await getJson<RawSearchResponse>(url, this.fetchImpl);
    const hits = (raw.results ?? []).map(normalizeSearchResult).filter((h): h is SearchHit => h !== null);
    this.searchCache.set(key, hits);
    return hits;
  }

  async entry(id: string): Promise<Entry | null> {
    const lodId = id.trim().toUpperCase();
    if (!isLodId(lodId)) throw new UpstreamError(`"${id}" is not a valid LOD article ID (e.g. HAUS1).`, 400);
    const cached = this.entryCache.get(lodId);
    if (cached !== undefined) return cached;
    let entry: Entry | null;
    try {
      const raw = await getJson<RawEntryResponse>(`${this.base}/entry/${encodeURIComponent(lodId)}`, this.fetchImpl);
      entry = normalizeEntry(raw);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) entry = null;
      else throw err;
    }
    this.entryCache.set(lodId, entry);
    return entry;
  }

  /**
   * Resolve free input to an entry: accepts an LOD ID ("HAUS1") or a
   * Luxembourgish word ("Haus", "mécht"), in which case the best search hit is used.
   */
  async resolve(idOrWord: string): Promise<{ entry: Entry | null; via?: SearchHit; alternatives: SearchHit[] }> {
    const s = idOrWord.trim();
    if (isLodId(s) && /\d$/.test(s)) {
      const entry = await this.entry(s);
      if (entry) return { entry, alternatives: [] };
    }
    const hits = await this.search(s, "lb");
    if (!hits.length) return { entry: null, alternatives: [] };
    const lower = s.toLowerCase();
    const best = hits.find((h) => h.lemma.toLowerCase() === lower) ?? hits[0];
    const entry = await this.entry(best.id);
    return { entry, via: best, alternatives: hits.filter((h) => h.id !== best.id).slice(0, 5) };
  }
}
