<!--
  DRAFT for review by ZLS. Edit freely on GitHub; the server reads this file at start-up
  and shows it to the AI before it writes Luxembourgish (tool lb_writing_guide, and as
  a footer in lb_check_draft). Keep it short: every line costs attention.
  Lines marked [?] are ones the drafter was unsure about. Fix or delete, then remove the [?].
-->
# Writing Luxembourgish: rules for AI

**Never write German with Luxembourgish spelling.** If unsure of a word, look it up (lod_search with lang=de/fr/en) instead of adapting the German word. Before answering, run lb_check_draft on every Luxembourgish text and fix what it reports.

## Articles and gender (gender comes from LOD, not from German)
- Definite article, nom./acc.: masc. **den/de** (n-rule), fem. **d'**, neuter **d'**, plural **d'**. → *d'Stad*, *d'Haus*, *den Hond*, *d'Kanner*
- Dative: masc./neuter **dem**, fem. **der**, plural **den/de**. → *mat der Stad*, *mat de Kanner*
- Contract preposition + dem: **mam, vum, zum, beim, am, um** (*mat dem* → *mam*). → *mam Auto*, *am Haus*, *um Dësch*
- Indefinite: masc./neuter **en/e** (n-rule), fem. **eng**; dative **engem** / **enger**. → *e Kaffi*, *eng Fra*, *mat engem Frënd*
- Personal names take the article: *de Pierre*, *d'Anna*. [?] Women's and girls' first names are often neuter: *d'Anna … hatt*.
- Gender can differ from German. Always check the noun in LOD: *den Auto*, *de Radio* (both masc.; German *das*). [?] add more typical traps

## Possessives and "kee(n)" follow the article
- *mäin/deng/säin/hiren/eisen/ären*, fem. + plural *meng/deng/seng/hir/eis/är*; dative *mengem* (m./n.), *menger* (f.), *menge(n)* (pl.). → *mat menge Frënn*, *vu menger Mamm*
- *keen* (m./n.), *keng* (f./pl.), n-rule: *kee Problem*.

## Cases
- No everyday genitive. Use the possessive dative or *vun*: *dem Papp säin Auto*, *d'Haus vu mengem Brudder*.
- Always dative after **mat, vun, bei, zu, no, aus, zënter, vis-à-vis**. → *mat de Kanner*, never *mat d'Kanner*.

## Verbs
- **Past = perfect** (*hunn/sinn* + participle). The simple past exists only for a few verbs (*war, hat, goung, koum, sot, gouf, wollt, konnt, misst, sollt, duerft* …). Only use it if LOD lists it (lod_get_inflection).
- **sinn** with verbs of motion and change of state: *goen, kommen, fueren, falen, bleiwen, ginn* (werden), *stierwen* … → *mir si gaangen* (not *hunn … gaangen*). Check the auxiliary in LOD.
- Luxembourgish participles are NOT the German ones: *gaangen, komm, gesinn, gedronk, giess, gesot, gemaach, gewiescht, ginn, fonnt, bruecht, bliwwen, geschwat, gefuer, kaf*.
- Conditional: *géif/géing* + infinitive, or the synthetic forms *wier, hätt, kéint, misst, sollt, wéilt* [?]. → *ech géif gäre kommen*
- Future: present tense (+ time adverb). *wäerten* expresses probability/intention; don't copy German *werden* everywhere. [?]
- Passive: **ginn** + participle, perfect **ass … ginn**. → *d'Haus gëtt gebaut*, *d'Haus ass gebaut ginn* (not *worden*)
- *es gibt* = **et gëtt**; *um … zu* = **fir … ze**; *als* in comparisons = **wéi** (*méi grouss wéi*).
- [?] Verb cluster order in subordinate clauses: *datt hien dat maache wëll* / *datt hien dat wëll maachen*. Both are possible; the second is more usual? Please confirm.

## n-rule (Eifeler Regel)
- Final -n stays only before a vowel, **n, d, t, z, h** and before a pause; otherwise it is dropped: *de Mann*, *den Apel*, *mir maache Kaffi*, *mir maachen dat*.

## Pronouns and address
- *ech, du (de), hien (en), hatt (et), si (se), mir (mer), dir (der), si (se)*. Polite form: **Dir** + 2nd-person plural verb: *Kënnt Dir mer hëllefen?*
- Question words: *wien, wat, wou, wéini, firwat, wéi, wéivill*. German *wann?* = **wéini?**; Luxembourgish *wann* = "if/when".

## Vocabulary: prefer established Luxembourgish (incl. French loans) over German
- *Vëlo* (not Fahrrad), *Gare*, *Spidol*, *Trottoir*, *Gromperen*, *Suen* (money), *Moien*, *Äddi*, *merci*, *wannechgelift*.
- Numbers: *zwee* (m./n.) vs **zwou** (f.): *zwou Frae*.
- See resources/germanisms.tsv for the correction list used by the checker.
