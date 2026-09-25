# Review notes (v0.1.0)

What I built, what I couldn't verify from my build environment, and what needs a decision before this goes public.

## 1. What to verify first (≈20 minutes)

1. `npm install && npm run build && npm test`. All 51 tests should pass offline.
2. `npm run smoke` makes live calls to lod.lu. **I could not reach lod.lu or data.public.lu from my build sandbox.** I checked the API response shapes by fetching them through a separate web tool, and the test fixtures were built from those responses. Things to look at:
   - `lod_search` with `lang=de|fr|en|pt` (checked for `en`; the others should behave the same).
   - `lod_get_entry` on a word with several `microStructures` (e.g. a word that is both a noun and a verb). I only saw entries with one microStructure.
   - `lod_get_inflection` for a separable verb (`separableVerb: "yes"`) and for a noun. Table types I haven't seen fall back to a generic bullet list.
3. `npm run smoke -- --corpus` downloads `lu-fr-de-en.zip`. **I have not seen the file's contents.** The loader prefers TMX 1.4 (a standard format, so parsing should work) and falls back to JSONL with automatic language-key detection. If the result shows 0 segments or odd language codes, send me the first lines of the JSONL or one `<tu>`.
4. `npm run inspect` opens the MCP Inspector. Click through every tool.
5. Install `zls-letzebuergesch.mcpb` in Claude Desktop and try the example questions in the README.

## 2. Known limitations

| Area | Limitation | Possible fix |
|---|---|---|
| n-rule | A heuristic: a curated list of function words, plus the generic unstressed *-en* ending checked against Hunspell, plus optional LOD `nRuleForm` confirmation. It works one token at a time and has no sentence-level grammar. The pronoun *si* and inflected forms that aren't lemmas are the weak spots. Every hint has a confidence level. | Swap in the in-house EifelerRegel module (spellchecker.lu extension, `rules.xml`), either ported to TS or run as a sidecar. `src/spell/nrule.ts` has a single entry point, `checkNRule()`. |
| Spelling | Uses the public 2023 spellchecker.lu dictionary (v2.1). If ZLS has a newer internal build, point `ZLS_HUNSPELL_DIR` at it. | Publish the current dictionary, or bundle it. |
| Spelling | nspell doesn't handle Hunspell morphological fields. Without a fix, ~20,000 entries such as `haut po:adverb` were rejected. They are now stripped when the dictionary loads (`stripMorphology`). If you see a correct word flagged, this is the first place to look. | – |
| Grammar | No grammar checking beyond the n-rule (e.g. *fir de Kanner* instead of *fir d'Kanner* isn't flagged). | Out of scope for v1. |
| LOD search | Matches exactly, not fuzzily. For misspelled input the tool description tells the model to run the spellchecker first. | Fuzzy search over the CC0 search-index dump. |
| Corpus | Loaded fully into memory. That's fine at ~150k words. | – |
| Sproochmaschinn | Not included because there's no public API. | Add TTS/ASR tools once an endpoint and its auth are available. |

## 3. Decisions needed

1. **Official ZLS branding.** The server name is `zls-letzebuergesch` and the title is "ZLS – Lëtzebuergesch". An official listing needs sign-off from ZLS management (and possibly the Ministry). An icon with the real ZLS logo is still to do; the icon included is a neutral placeholder.
2. **Code licence.** I set EUPL-1.2, the usual choice for Luxembourg and EU public-sector code, and compatible with the EUPL-1.1 dictionary. Please confirm.
3. **Corpus licence.** data.public.lu lists the multilingual corpus as **CC0**. If the Hugging Face release is CC-BY 4.0, the two listings should be made to match. Either way, every `corpus_search` result already includes an attribution line.
4. **Speller copyright.** The public dictionary is licensed EUPL-1.1 with copyright held by Michel Weimerskirch and Sandra Souza Morais. This fits the "ZLS acquired spellchecker.lu" understanding, but the NOTICE should name ZLS if ZLS now holds the rights. The public EUPL licence may also help with the Microsoft commercial-use question.
5. **Rate limiting / load on lod.lu.** Every LOD call is cached for 6 hours. A public remote server should also get per-IP rate limiting, and it would be good to tell the LOD team to expect traffic from the `zls-letzebuergesch-mcp/<version>` User-Agent.

## 4. Path to a public connector

- **Remote connector (Claude Connectors Directory).** Host `dist/http.js` behind HTTPS, e.g. on ZLS/CTIE infrastructure; stateless mode scales horizontally. Submission goes through the claude.ai admin portal, which needs a **Team or Enterprise** organization. You'll also need a privacy-policy URL, a documentation URL, a support contact and an icon. Auth would be "none" (public read-only data). Every tool already has a `title` and `readOnlyHint`, which the directory requires.
- **Desktop extension (MCPB).** `manifest.json` is ready and builds with `npx @anthropic-ai/mcpb pack`. It can be submitted through the desktop-extension form without a Team plan. It needs the privacy-policy URL in `manifest.json` (currently a TODO placeholder).
- Either way: fill in the TODOs in `PRIVACY.md`, publish it on zls.lu, and put the source in a public repo (e.g. github.com/ZLSGeneral).

## 5. v0.2: grammar checks (added after the first live test)

- **New tools:**
  - `lb_check_draft` bundles spelling, Germanisms, hunn/sinn, gender, dative after prepositions and the n-rule.
  - `corpus_similar_sentences` gives example sentences to imitate when translating.
  - `lb_writing_guide` serves the ZLS writing rules.
- **Stricter server instructions:** the AI must now read the guide, retrieve similar sentences, look up uncertain words, and run `lb_check_draft` before showing any Luxembourgish.
- **Please correct:**
  - `resources/grammar-notes.md`, especially the lines marked [?].
  - `resources/germanisms.tsv`.
- **Conservative by design:** gender is judged only when the noun is exactly an LOD headword with a single gender; *de/den* after a dative preposition is not judged, because it could be a plural dative; and *sinn* + a *hunn*-verb is only "low", because it could be a state passive.
- **Not covered:** word order and verb clusters, tense choice, idiom and register. Covering these would need a real parser or LOD's full example base.
- **Possible next step:** load the monthly CC0 LOD dump (lod-art zip) at start-up instead of calling the API. That would give instant, offline gender and auxiliary lookups for every word and a searchable base of about 50k checked example sentences.
