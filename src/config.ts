import os from "node:os";
import path from "node:path";

/**
 * Runtime configuration. Everything can be overridden with environment
 * variables so the same build runs locally (stdio) and on a server (HTTP).
 */
function env(name: string, fallback: string): string {
  const v = process.env[name];
  // Unfilled MCPB placeholders ("${user_config.x}") count as unset.
  return v === undefined || v.trim() === "" || v.includes("${") ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

export const VERSION = "0.1.0";

export const config = {
  /** Base URL of the LOD public API (CC0). */
  lodApiBase: env("ZLS_LOD_API_BASE", "https://lod.lu/api/lb"),
  /** Public web base for building human-facing links. */
  lodWebBase: env("ZLS_LOD_WEB_BASE", "https://lod.lu"),
  /** Per-request timeout for upstream calls. */
  httpTimeoutMs: envInt("ZLS_HTTP_TIMEOUT_MS", 10_000),
  /** How long LOD responses are cached in memory. */
  lodCacheTtlMs: envInt("ZLS_LOD_CACHE_TTL_MS", 6 * 60 * 60 * 1000),
  lodCacheMaxEntries: envInt("ZLS_LOD_CACHE_MAX", 2_000),

  /**
   * Hunspell dictionary directory containing <name>.aff and <name>.dic.
   * Empty = use the bundled npm package `dictionary-lb`
   * (spellchecker.lu dictionary, EUPL-1.1).
   */
  hunspellDir: env("ZLS_HUNSPELL_DIR", ""),
  hunspellName: env("ZLS_HUNSPELL_NAME", "lb_LU"),

  /**
   * Méisproochegen Iwwersetzungskorpus (CC0). Either a local file
   * (.zip, .tmx, .jsonl) or a download URL. The local path wins.
   */
  corpusPath: env("ZLS_CORPUS_PATH", ""),
  corpusUrl: env(
    "ZLS_CORPUS_URL",
    "https://download.data.public.lu/resources/meisproochegen-iwwersetzungskorpus-fir-dletzebuergescht/20260508-134457/lu-fr-de-en.zip",
  ),
  cacheDir: env("ZLS_CACHE_DIR", path.join(os.homedir(), ".cache", "zls-mcp")),

  /** HTTP transport */
  httpHost: env("HOST", "127.0.0.1"),
  httpPort: envInt("PORT", 3000),
  /** Comma-separated list of allowed Host headers when binding publicly. */
  allowedHosts: env("ZLS_ALLOWED_HOSTS", ""),

  userAgent: env(
    "ZLS_USER_AGENT",
    `zls-letzebuergesch-mcp/${VERSION} (+https://zls.lu)`,
  ),
};
