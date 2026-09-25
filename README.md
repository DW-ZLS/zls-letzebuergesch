# ZLS – Lëtzebuergesch (MCP server)

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude and others) the
Luxembourgish language resources of the **Zenter fir d'Lëtzebuerger Sprooch (ZLS)**:

| Tool | What it does | Source |
|---|---|---|
| `lod_search` | Find Luxembourgish words: by headword **or inflected form** (*mécht → maachen*), or from DE/FR/EN/PT (*Schmetterling → Päiperlek*) | LOD API (live) |
| `lod_get_entry` | Full entry: meanings, DE/FR/EN/PT translations with sense clarifiers, examples + glosses, IPA, audio, n-rule form, synonyms, related words | LOD API (live) |
| `lod_get_inflection` | Conjugation tables (all tenses, auxiliary, participle, conditional, imperative) and adjective declension | LOD API (live) |
| `lb_spellcheck` | Spelling with suggestions + n-rule (Eifeler Regel) hints; handles *d'*/*z'* elisions and hyphenated compounds | spellchecker.lu Hunspell dictionary (local) |
| `lb_n_rule_check` | Eifeler Regel only, with confidence levels, optionally confirmed against LOD's `nRuleForm` | heuristic + LOD |
| `corpus_search` | Real, professionally translated usage: search LB/FR/DE/EN, get the aligned segments | Méisproochegen Iwwersetzungskorpus (local) |

Also: a `zls://about` resource (sources and licences) and a `proofread_luxembourgish` prompt.

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
npm run build
npm test            # offline unit + protocol tests (fixtures)
npm run smoke       # live calls against lod.lu (needs internet)
npm run smoke -- --corpus   # also downloads and searches the corpus (~5 MB, cached)
npm run inspect     # opens the MCP Inspector for manual testing
```

### Claude Desktop

Settings → Developer → Edit config, then add (adjust the path):

```json
{
  "mcpServers": {
    "zls-letzebuergesch": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/zls-mcp/dist/stdio.js"]
    }
  }
}
```

Or install the packaged extension `zls-letzebuergesch.mcpb` (double-click / drag into Claude Desktop).

### Claude Code

```bash
claude mcp add zls-letzebuergesch -- node /ABSOLUTE/PATH/zls-mcp/dist/stdio.js
```

### Remote (Streamable HTTP) — for later public hosting

```bash
npm run start:http                      # http://127.0.0.1:3000/mcp (stateless), /healthz
HOST=0.0.0.0 PORT=8080 ZLS_ALLOWED_HOSTS=mcp.example.lu npm run start:http
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `ZLS_LOD_API_BASE` | `https://lod.lu/api/lb` | LOD API base |
| `ZLS_LOD_CACHE_TTL_MS` | 6 h | In-memory cache for LOD responses |
| `ZLS_HTTP_TIMEOUT_MS` | 10000 | Upstream timeout |
| `ZLS_HUNSPELL_DIR` / `ZLS_HUNSPELL_NAME` | *(bundled `dictionary-lb`)* / `lb_LU` | Use another Hunspell dictionary, e.g. the current internal ZLS build |
| `ZLS_CORPUS_PATH` | – | Local corpus file or folder (`.zip`, `.tmx`, `.jsonl`) |
| `ZLS_CORPUS_URL` | data.public.lu `lu-fr-de-en.zip` | Downloaded once into `ZLS_CACHE_DIR` if no local path is set |
| `ZLS_CACHE_DIR` | `~/.cache/zls-mcp` | Download cache |
| `HOST`, `PORT`, `ZLS_ALLOWED_HOSTS` | `127.0.0.1`, `3000`, – | HTTP transport |

## Example questions

- “What's the Luxembourgish for *butterfly*, and how do you pronounce it?”
- “Conjugate *goen* in the simple past and the conditional.”
- “Proofread this: *Den Mann drénkt Kaffi a Uebst.*”
- “How has *logement abordable* been translated into Luxembourgish?”

## Project layout

```
src/
  server.ts            tool/resource/prompt registration
  stdio.ts, http.ts    transports
  lod/                 LOD client, normaliser, markdown formatting
  spell/               Hunspell wrapper, tokenizer, n-rule heuristic
  corpus/              TMX/JSONL/ZIP loader, search
  tools/               MCP tool definitions
  scripts/smoke.ts     live smoke test
test/                  vitest suites + fixtures
```

## Privacy Policy

This server does not store, log or share user text.

- **Spellchecking, n-rule checks and corpus search run locally** inside the server process; text never leaves it.
- **Dictionary lookups** (`lod_search`, `lod_get_entry`, `lod_get_inflection`, and `verify_with_lod`) send only the looked-up word(s) to the public LOD API at lod.lu, operated by the ZLS. No identifiers, account data or full texts are sent.
- **Corpus download**: on first use the server downloads the public corpus file from data.public.lu.
- Responses from lod.lu are cached in memory only (default 6 hours) and discarded when the process ends.
- No telemetry, analytics or cookies. No third parties other than lod.lu and data.public.lu are contacted.

Contact: Zenter fir d'Lëtzebuerger Sprooch — see [PRIVACY.md](PRIVACY.md) for the full policy. *(TODO before publication: host PRIVACY.md at an HTTPS URL on zls.lu and add the contact address.)*

## Licences

- Code: EUPL-1.2 (see `LICENSE`).
- LOD data: CC0 (ZLS). Corpus: CC0 (ZLS).
- Spellchecker dictionary: EUPL-1.1, © Michel Weimerskirch et al. (spellchecker.lu), via the `dictionary-lb` npm package.

See [NOTICE.md](NOTICE.md).
