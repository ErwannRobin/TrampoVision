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

const twistText = (t: number): string =>
  t === 0 ? '' : t === 0.5 ? '½ twist' : t === 1 ? 'full twist' : `${t % 1 === 0.5 ? `${Math.floor(t)}½` : t} twists`;
const somersaultText = (s: number): string =>
  s === 1 ? 'somersault' : s === 2 ? 'double somersault' : 'triple somersault';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Name from the movement alone: "Back somersault, full twist (straight)". */
export function movementName(m: Movement): string {
  if (m.somersaults === 0) {
    const t = twistText(m.twists);
    return t ? `${cap(t)} jump` : `${cap(m.position)} jump`;
  }
  const parts = [`${cap(m.direction ?? 'back')} ${somersaultText(m.somersaults)}`];
  if (m.twists > 0) parts.push(twistText(m.twists));
  return `${parts.join(', ')} (${m.position})`;
}

/** The movements the Code lists in its table of examples (whole somersaults only: the table below has no quarter rotations). */
const LISTED = new Set(OFFICIAL_EXAMPLES.map((e) => movementKey(exampleMovement(e))));

function build(): FigElement[] {
  const out: FigElement[] = [];
  const add = (m: Movement) => {
    const id = `${m.direction ?? 'none'}-${m.somersaults}s-${m.twists}t-${m.position}`;
    out.push({ ...m, id, name: movementName(m), difficulty: difficultyValue(m), inCode: LISTED.has(movementKey(m)) });
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
