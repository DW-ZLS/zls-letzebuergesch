import { config } from "../config.js";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * GET a JSON document with a timeout, a descriptive User-Agent and one retry
 * on transient failures (network errors, 429, 5xx).
 */
export async function getJson<T>(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.httpTimeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": config.userAgent },
      });
      if (res.status === 404) throw new UpstreamError("Not found", 404);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new UpstreamError(`Upstream returned HTTP ${res.status}`, res.status);
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new UpstreamError(`Upstream returned HTTP ${res.status}`, res.status);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof UpstreamError && err.status && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
      if (attempt === 0) await sleep(400);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof UpstreamError) throw lastErr;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  let host = "upstream service";
  try {
    host = new URL(url).host;
  } catch {
    /* keep generic */
  }
  throw new UpstreamError(`Could not reach ${host} (${msg}). The dictionary service may be temporarily unavailable; please try again later.`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
