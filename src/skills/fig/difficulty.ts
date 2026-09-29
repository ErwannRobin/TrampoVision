/**
 * Official FIG difficulty values and codes, keyed by element id (see `elements.ts`). EMPTY ON PURPOSE.
 *
 * Fill this from the FIG Trampoline Code of Points only. The classifier never reads it, and no model, rule or LLM may
 * decide a difficulty: `applyOfficialValues` copies what is written here onto the element table and nothing else.
 */
export interface OfficialValue {
  code: string;
  difficulty: number;
  /** Where the value was read: document, edition and page/table. */
  source: string;
}

export const OFFICIAL_VALUES: Readonly<Record<string, OfficialValue>> = {};
