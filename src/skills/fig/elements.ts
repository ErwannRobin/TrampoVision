import { getLocale, lower, t, tp, upperFirst, type Locale } from '../../i18n/core';
import type { KnownPosition } from '../types';
import { OFFICIAL_EXAMPLES, difficultyValue, exampleMovement } from './difficulty';

/**
 * The element table: the ONLY place where an element, its name and its difficulty live. The classifier never predicts a value;
 * it produces a `Movement` and `movementToElement` looks it up here, deterministically.
 *
 * The rows are generated from the movement space below (direction x somersaults x twists x position), so every reachable
 * movement has exactly one row. The difficulty of each row is the FIG rule of `difficulty.ts` applied to the movement, and
 * `inCode` marks the rows that the Code of Points itself lists with a value (Part II, appendix C): the rest follow the same rule
 * but are not written out in the Code.
 */

export type Direction = 'front' | 'back';

/** What was recognized, independent of any naming scheme. */
export interface Movement {
  /** null when the body does not somersault. */
  direction: Direction | null;
  /** Full somersaults (0, 1, 2, 3). */
  somersaults: number;
  /** Full twists; halves are allowed (0, 0.5, 1, 1.5, ...). */
  twists: number;
  position: KnownPosition;
}

export interface FigElement extends Movement {
  /** Stable key, derived from the movement: `back-1s-1t-straight`. */
  id: string;
  /** The name in English, the same in every language: what is kept in data. To show, use `elementName`, which follows the language. */
  name: string;
  /** Difficulty value by the FIG rule (`difficulty.ts`). */
  difficulty: number;
  /** The Code of Points lists this movement, with this value, in its table of examples. */
  inCode: boolean;
}

export const SOMERSAULT_MAX = 3;
/** Largest number of half twists modelled for a somersault count (index = somersaults). */
export const MAX_HALF_TWISTS = [3, 6, 6, 4] as const;

const POSITIONS: KnownPosition[] = ['tuck', 'pike', 'straight'];

export function movementKey(m: Movement): string {
  return `${m.direction ?? 'none'}|${m.somersaults}|${m.twists}|${m.position}`;
}

const SOMERSAULT_KEYS = ['name.somersault.1', 'name.somersault.2', 'name.somersault.3'] as const;
const SOMERSAULT_ANY_KEYS = ['name.somersault.1.any', 'name.somersault.2.any', 'name.somersault.3.any'] as const;
const somersaultIndex = (somersaults: number) => Math.min(Math.max(Math.round(somersaults), 1), 3) - 1;

/** The twists in words: "½ twist", "full twist", "1½ twists", "2 twists" (empty for none). */
export function twistName(twists: number, locale: Locale = getLocale()): string {
  if (twists <= 0) return '';
  if (twists === 0.5) return t('name.twist.half', undefined, locale);
  if (twists === 1) return t('name.twist.full', undefined, locale);
  return twists % 1 === 0.5
    ? tp('name.twist.manyHalf', twists, { n: Math.floor(twists) }, locale)
    : tp('name.twist.many', twists, undefined, locale);
}

/** A somersault count in words, with its direction when there is one: "back double somersault", "somersault". */
export function somersaultName(somersaults: number, direction: Direction | null, locale: Locale = getLocale()): string {
  const i = somersaultIndex(somersaults);
  if (!direction) return t(SOMERSAULT_ANY_KEYS[i], undefined, locale);
  return t(SOMERSAULT_KEYS[i], { direction: lower(t(`dir.${direction}`, undefined, locale), locale) }, locale);
}

/** Name from the movement alone: "Back somersault, full twist (straight)". In the language in use unless another is asked for. */
export function movementName(m: Movement, locale: Locale = getLocale()): string {
  if (m.somersaults === 0) {
    const twist = twistName(m.twists, locale);
    return upperFirst(
      twist ? t('name.jumpTwist', { twist }, locale) : t(`name.jump.${m.position}`, undefined, locale),
      locale,
    );
  }
  let name = somersaultName(m.somersaults, m.direction ?? 'back', locale);
  if (m.twists > 0) name = t('name.withTwist', { name, twist: twistName(m.twists, locale) }, locale);
  const position = lower(t(`pos.${m.position}`, undefined, locale), locale);
  return upperFirst(t('name.withPosition', { name, position }, locale), locale);
}

/** The movements the Code lists in its table of examples (whole somersaults only: the table below has no quarter rotations). */
const LISTED = new Set(OFFICIAL_EXAMPLES.map((e) => movementKey(exampleMovement(e))));

function build(): FigElement[] {
  const out: FigElement[] = [];
  const add = (m: Movement) => {
    const id = `${m.direction ?? 'none'}-${m.somersaults}s-${m.twists}t-${m.position}`;
    out.push({
      ...m,
      id,
      name: movementName(m, 'en'),
      difficulty: difficultyValue(m),
      inCode: LISTED.has(movementKey(m)),
    });
  };
  // No somersault: the three basic jumps, and straight jumps with twists.
  for (const position of POSITIONS) add({ direction: null, somersaults: 0, twists: 0, position });
  for (let h = 1; h <= MAX_HALF_TWISTS[0]; h++)
    add({ direction: null, somersaults: 0, twists: h / 2, position: 'straight' });
  // Somersaults: twisting elements are straight or piked/tucked in the same way as plain ones.
  for (let s = 1; s <= SOMERSAULT_MAX; s++)
    for (const direction of ['front', 'back'] as const)
      for (let h = 0; h <= MAX_HALF_TWISTS[s]; h++)
        for (const position of POSITIONS) add({ direction, somersaults: s, twists: h / 2, position });
  return out;
}

export const FIG_ELEMENTS: readonly FigElement[] = build();

const BY_KEY = new Map(FIG_ELEMENTS.map((e) => [movementKey(e), e]));
const BY_ID = new Map(FIG_ELEMENTS.map((e) => [e.id, e]));

/** Movement -> element. Null when the movement is not in the table (e.g. four somersaults). */
export function movementToElement(m: Movement): FigElement | null {
  return BY_KEY.get(movementKey({ ...m, direction: m.somersaults === 0 ? null : m.direction })) ?? null;
}

export const elementById = (id: string): FigElement | undefined => BY_ID.get(id);

const NAMES = new Map<string, string>();
/** What an element is called in the language in use (`element.name` is the English name that data keeps). */
export function elementName(e: Movement): string {
  const key = `${getLocale()}|${movementKey(e)}`;
  let name = NAMES.get(key);
  if (name === undefined) NAMES.set(key, (name = movementName(e)));
  return name;
}
