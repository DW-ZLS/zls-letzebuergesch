/**
 * Loose typings for the LOD public API (https://lod.lu/api/doc).
 * Everything is optional on purpose: the API is not versioned, so the
 * normaliser must survive missing or new fields.
 */

export type LodLang = "lb" | "de" | "fr" | "en" | "pt";
export const LOD_LANGS: readonly LodLang[] = ["lb", "de", "fr", "en", "pt"] as const;
export const TARGET_LANGS = ["de", "fr", "en", "pt"] as const;
export type TargetLang = (typeof TARGET_LANGS)[number];

export interface RawSearchMeaning {
  id?: string;
  translation?: string;
  number?: number;
  secondaryHeadword?: string;
  sign_language?: boolean;
}

export interface RawSearchResult {
  id?: string;
  article_id?: string;
  word_lb?: string;
  scientific_name?: string;
  pos?: string;
  erroneous?: boolean;
  sign_language?: boolean;
  matches?: string[];
  meanings?: RawSearchMeaning[];
}

export interface RawSearchResponse {
  description?: string;
  results?: RawSearchResult[];
}

export interface RawPart {
  type?: string;
  content?: string;
  joinWithPreviousWord?: boolean;
  parts?: RawPart[];
  [k: string]: unknown;
}

export interface RawExample {
  parts?: RawPart[];
  hasInfobox?: boolean;
  audioFiles?: { ogg?: string; aac?: string };
}

export interface RawMeaning {
  meaningID?: string;
  number?: number;
  meaningVideo?: string;
  inflection?: { forms?: Array<{ content?: string; [k: string]: unknown }> };
  targetLanguages?: Partial<Record<string, { parts?: RawPart[] }>>;
  examples?: RawExample[];
  [k: string]: unknown;
}

export interface RawGrammaticalUnit {
  grammaticalInformation?: string[] | string;
  meanings?: RawMeaning[];
  [k: string]: unknown;
}

export interface RawMicroStructure {
  partOfSpeech?: string;
  partOfSpeechLabel?: string;
  auxiliaryVerb?: string;
  pastParticiple?: string[] | string;
  grammaticalUnits?: RawGrammaticalUnit[];
  [k: string]: unknown;
}

export interface RawSynonymGroup {
  number?: number;
  fromTerms?: string[];
  toSynonyms?: Array<{ syn?: string }>;
}

export interface RawEntry {
  lod_id?: string;
  partOfSpeech?: string;
  partOfSpeechLabel?: string;
  lemma?: string;
  nRuleForm?: string;
  trademark?: boolean;
  ipa?: string;
  tables?: Record<string, unknown>;
  microStructures?: RawMicroStructure[];
  audioString?: string;
  audioFiles?: { ogg?: string; aac?: string };
  allSynonyms?:
    | unknown[]
    | {
        synonymGroups?: RawSynonymGroup[];
        otherPotentialSynonyms?: { synonyms?: Array<{ syn?: string }> };
      };
  videos?: Array<{ meaningID?: string; meaningVideo?: string; meaningNumber?: number }>;
  infoboxes?: unknown;
  categories?: Array<{ label?: string; code?: string }>;
  entryImage?: string;
}

export interface RawEntryResponse {
  entry?: RawEntry;
  entryImage?: string;
  previousEntries?: Array<{ lodID?: string; lemma?: string }>;
  nextEntries?: Array<{ lodID?: string; lemma?: string }>;
}

/* ---------- normalised shapes returned by the tools ---------- */

export interface SearchHit {
  id: string;
  lemma: string;
  pos: string;
  posLabel: string;
  matchedForms: string[];
  erroneous: boolean;
  signLanguage: boolean;
  scientificName?: string;
  meanings: Array<{ id: string; number: number; translation: string; secondaryHeadword?: string }>;
  url: string;
}

export interface Translation {
  text: string;
  clarifier?: string;
  notes?: string[];
}

export interface Example {
  text: string;
  gloss?: string;
  labels: string[];
  audio?: string;
}

export interface Meaning {
  id: string;
  number: number;
  translations: Partial<Record<TargetLang, Translation[]>>;
  forms: string[];
  examples: Example[];
  exampleCount: number;
  extra: Record<string, string>;
}

export interface Entry {
  id: string;
  lemma: string;
  pos: string;
  posLabel: string;
  ipa?: string;
  nRuleForm?: string;
  trademark: boolean;
  audio?: string;
  audioString?: string;
  url: string;
  sections: Array<{
    pos: string;
    posLabel: string;
    auxiliaryVerb?: string;
    pastParticiple: string[];
    units: Array<{ grammaticalInformation: string[]; meanings: Meaning[] }>;
  }>;
  synonyms: Array<{ terms: string[]; synonyms: string[] }>;
  otherSynonyms: string[];
  seeAlso: Array<{ lemma: string; id: string }>;
  categories: string[];
  hasInflectionTables: boolean;
  tables?: Record<string, unknown>;
}
