import { t } from '../../i18n/core';
import type { KnownPosition } from '../types';
import type { Direction, Movement } from './elements';

/**
 * Difficulty of an element, from the FIG Code of Points 2025-2028, Trampoline Gymnastics, Part I §17.1 (the rule) and checked
 * against Part II appendix C (the table of examples, kept below as `OFFICIAL_EXAMPLES` and asserted in `difficulty.test.ts`).
 *
 * The classifier never reads this file and no model decides a difficulty: the recognized movement goes in, the published rule
 * comes out. The rule, in the Code's own words (§17.1):
 *
 *   17.1.1.1  each additional quarter somersault                 0.1
 *   17.1.1.2-5  a complete single / double / triple / quadruple   0.5 / 1.0 / 1.6 / 2.2
 *   17.1.1.6  each half twist                                     0.1
 *   17.1.2    tuck jump, pike jump, straddle jump, seat drop      0.1 (a plain straight jump is not an element: 0)
 *   17.1.4    360° to 630° without twist, pike or straight       +0.1
 *   17.1.5    720° or more, pike or straight                      +0.1 per somersault
 *   17.1.6.1  backward double 720°-990° +0.1, triple 1080°-1350° +0.2, quadruple +0.3
 *   17.1.6.2  twisting double: each half twist past 720° of twist    +0.1
 *   17.1.6.3  twisting triple: each half twist past 360° of twist    +0.2
 *   17.1.6.4  twisting quadruple: each half twist                  +0.2
 *
 * Not modelled: the exercise bonus of §17.1.7, the limits of junior and age-group competitions, and the phase of a twist
 * (the value only depends on the total, which is what the classifier measures).
 */

export const DIFFICULTY_SOURCE = 'FIG Code of Points 2025-2028, Trampoline, Part I §17.1';

/** Value of a complete somersault count (index = somersaults), §17.1.1.2 to 17.1.1.5. */
const COMPLETE = [0, 0.5, 1.0, 1.6, 2.2] as const;
const QUARTER = 0.1;
const HALF_TWIST = 0.1;
/** Bonus for a backward multiple somersault (§17.1.6.1), index = complete somersaults. */
const BACKWARD_BONUS = [0, 0, 0.1, 0.2, 0.3] as const;
/** Half twists a multiple somersault may carry before each further one earns a bonus (§17.1.6.2 to 17.1.6.4), and what it earns. */
const TWIST_BONUS_AFTER = [Infinity, Infinity, 4, 2, 0] as const;
const TWIST_BONUS = [0, 0, 0.1, 0.2, 0.2] as const;

export interface DifficultyPart {
  label: string;
  value: number;
  /** The article of the Code the part comes from. */
  rule: string;
}

export interface Difficulty {
  /** Sum of the parts, in tenths. */
  value: number;
  parts: DifficultyPart[];
}

const tenths = (v: number) => Math.round(v * 10) / 10;

/** Difficulty of a movement by the published rule. A somersault count that is not a whole number of quarters is rounded to one. */
export function difficultyOf(m: Movement): Difficulty {
  const quarters = Math.max(0, Math.round(m.somersaults * 4));
  const complete = Math.min(Math.floor(quarters / 4), COMPLETE.length - 1);
  const extra = quarters - Math.floor(quarters / 4) * 4;
  const halfTwists = Math.max(0, Math.round(m.twists * 2));
  const parts: DifficultyPart[] = [];
  const add = (label: string, value: number, rule: string) => {
    if (value > 0) parts.push({ label, value: tenths(value), rule });
  };

  if (quarters === 0) {
    // A plain jump: tuck, pike and straddle jumps are elements worth 0.1, a straight jump is not; a twist adds its own value.
    if (halfTwists === 0) add(t('difficulty.jump'), m.position === 'straight' ? 0 : 0.1, '17.1.2');
    else add(t('difficulty.twists'), halfTwists * HALF_TWIST, '17.1.1.6');
    return { value: tenths(parts.reduce((s, p) => s + p.value, 0)), parts };
  }

  add(
    complete > 0
      ? extra > 0
        ? t('difficulty.somersaultsQuarters')
        : t('difficulty.somersaults')
      : t('difficulty.quarters'),
    COMPLETE[complete] + extra * QUARTER,
    complete > 0 ? '17.1.1.2 to 17.1.1.5' : '17.1.1.1',
  );
  add(t('difficulty.twists'), halfTwists * HALF_TWIST, '17.1.1.6');

  if (halfTwists > TWIST_BONUS_AFTER[complete])
    add(
      t('difficulty.twistingMultiple'),
      (halfTwists - TWIST_BONUS_AFTER[complete]) * TWIST_BONUS[complete],
      '17.1.6.2 to 17.1.6.4',
    );

  if (m.direction === 'back' && complete >= 2)
    add(t('difficulty.backwardMultiple'), BACKWARD_BONUS[complete], '17.1.6.1');

  if (m.position !== 'tuck') {
    const positionLabel = m.position === 'pike' ? t('difficulty.pike') : t('difficulty.straight');
    if (complete >= 2) add(positionLabel, 0.1 * complete, '17.1.5');
    else if (quarters >= 4 && quarters <= 7 && halfTwists === 0) add(positionLabel, 0.1, '17.1.4');
  }
  return { value: tenths(parts.reduce((s, p) => s + p.value, 0)), parts };
}

/** The value alone. */
export const difficultyValue = (m: Movement): number => difficultyOf(m).value;

/** Difficulty of a movement whose direction is not known: the smallest and the largest value over front and back. */
export function difficultyRange(m: Movement): { min: number; max: number } {
  if (m.direction !== null) {
    const v = difficultyValue(m);
    return { min: v, max: v };
  }
  const values = (['front', 'back'] as const).map((direction) => difficultyValue({ ...m, direction }));
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Two elements are the same element (a repetition, §14) when direction, rotation, twist and position all agree. */
export const sameElement = (a: Movement, b: Movement): boolean =>
  a.direction === b.direction && a.somersaults === b.somersaults && a.twists === b.twists && a.position === b.position;

export interface DifficultyTotal {
  /** Sum of the values, a repeated element counted once (§14.1). */
  value: number;
  /** Per input, the value that counts (0 for a repetition). */
  counted: number[];
  /** Per input, true when an earlier one is the same element. */
  repeated: boolean[];
}

/** The difficulty of a list of elements in the order they were performed: what each earns, and the sum. `null` = not an element (nothing counts). */
export function totalDifficulty(elements: readonly (Movement | null)[]): DifficultyTotal {
  const seen: Movement[] = [];
  const counted: number[] = [];
  const repeated: boolean[] = [];
  for (const m of elements) {
    if (!m) {
      counted.push(0);
      repeated.push(false);
      continue;
    }
    const dup = seen.some((s) => sameElement(s, m));
    repeated.push(dup);
    counted.push(dup ? 0 : difficultyValue(m));
    if (!dup) seen.push(m);
  }
  return { value: tenths(counted.reduce((s, v) => s + v, 0)), counted, repeated };
}

// --- the official table of examples ----------------------------------------------------------------------------------

export interface OfficialExample {
  /** The name in the Code. */
  name: string;
  /** The FIG numeric code: quarter somersaults, then the half twists of each somersault. */
  code: string;
  direction: Direction;
  /** Quarter somersaults (4 = one somersault). */
  quarters: number;
  /** Half twists, all somersaults together. */
  halfTwists: number;
  position: KnownPosition;
  difficulty: number;
}

const SYMBOLS = { o: 'tuck', '<': 'pike', '/': 'straight' } as const satisfies Record<string, KnownPosition>;
type PositionSymbol = keyof typeof SYMBOLS;

/**
 * Part II, appendix C ("Difficulty trampoline - examples"), one entry per listed row. The two columns of the appendix are forward and
 * backward skills; the direction of each row is the column it is in. A row listed in several positions has one value per position.
 */
function examples(): OfficialExample[] {
  const out: OfficialExample[] = [];
  const add = (
    name: string,
    code: string,
    direction: Direction,
    quarters: number,
    halfTwists: number,
    values: Partial<Record<PositionSymbol, number>>,
  ) => {
    for (const [symbol, difficulty] of Object.entries(values) as [PositionSymbol, number][])
      out.push({
        name,
        code: `${code} ${symbol}`,
        direction,
        quarters,
        halfTwists,
        position: SYMBOLS[symbol],
        difficulty,
      });
  };
  const all = (v: number) => ({ o: v, '<': v, '/': v });
  const OPL = (o: number, l: number) => ({ o, '<': l, '/': l });
  const OP = (o: number, p: number) => ({ o, '<': p });

  // Drops and quarter rotations
  add('Front drop', '1 0', 'front', 1, 0, all(0.1));
  add('Back drop', '1 0', 'back', 1, 0, all(0.1));
  add('Half twist to back', '1 1', 'front', 1, 1, { '/': 0.2 });
  add('Full twist to front', '1 2', 'front', 1, 2, { '/': 0.3 });
  add('Half twist to front', '1 1', 'back', 1, 1, { '/': 0.2 });
  add('Full twist to back', '1 2', 'back', 1, 2, { '/': 0.3 });
  add('3/4 front', '3 0', 'front', 3, 0, { '/': 0.3 });
  add('3/4 back', '3 0', 'back', 3, 0, all(0.3));
  add('Barani to front', '3 1', 'front', 3, 1, all(0.4));
  add('Half in 3/4 front', '3 1', 'front', 3, 1, { '/': 0.4 });
  add('Back full to front', '3 2', 'back', 3, 2, { '/': 0.5 });

  // Singles
  add('Front somersault', '4 0', 'front', 4, 0, OPL(0.5, 0.6));
  add('Back somersault', '4 0', 'back', 4, 0, OPL(0.5, 0.6));
  add('Barani', '4 1', 'front', 4, 1, all(0.6));
  add('Back somersault with 1/2 twist', '4 1', 'back', 4, 1, all(0.6));
  add('Rudolph', '4 3', 'front', 4, 3, { '/': 0.8 });
  add('Randolph', '4 5', 'front', 4, 5, { '/': 1.0 });
  add('3 1/2 twisting front', '4 7', 'front', 4, 7, { '/': 1.2 });
  add('4 1/2 twisting front', '4 9', 'front', 4, 9, { '/': 1.4 });
  add('Back full', '4 2', 'back', 4, 2, { '/': 0.7 });
  add('Double full', '4 4', 'back', 4, 4, { '/': 0.9 });
  add('Triple full', '4 6', 'back', 4, 6, { '/': 1.1 });
  add('Quadruple full', '4 8', 'back', 4, 8, { '/': 1.3 });
  add('Barani ballout', '5 1', 'front', 5, 1, all(0.7));
  add('Cody (1 1/4 back)', '5 0', 'back', 5, 0, OPL(0.6, 0.7));
  add('Rudolph ballout', '5 3', 'front', 5, 3, { '/': 0.9 });
  add('Randolph ballout', '5 5', 'front', 5, 5, { '/': 1.1 });
  add('Cody with full twist', '5 2', 'back', 5, 2, { '/': 0.8 });
  add('Cody with double twist', '5 4', 'back', 5, 4, { '/': 1.0 });
  add('1 3/4 front', '7 0', 'front', 7, 0, OPL(0.8, 0.9));

  // Doubles (the code gives the half twists of each somersault)
  add('Double back', '8 00', 'back', 8, 0, OPL(1.1, 1.3));
  add('Half out', '8 01', 'front', 8, 1, OPL(1.1, 1.3));
  add('Rudy out', '8 03', 'front', 8, 3, OPL(1.3, 1.5));
  add('Half in half out', '8 11', 'back', 8, 2, OPL(1.3, 1.5));
  add('Full half', '8 21', 'front', 8, 3, OPL(1.3, 1.5));
  add('Back in full out', '8 02', 'back', 8, 2, OPL(1.3, 1.5));
  add('Full rudy', '8 23', 'front', 8, 5, OPL(1.6, 1.8));
  add('1 1/2 in half out', '8 31', 'back', 8, 4, OP(1.5, 1.7));
  add('Full in full out', '8 22', 'back', 8, 4, { o: 1.5, '/': 1.7 });
  add('Randy out', '8 05', 'front', 8, 5, OPL(1.6, 1.8));
  add('Half in rudy out', '8 13', 'back', 8, 4, OP(1.5, 1.7));
  add('Full randy', '8 25', 'front', 8, 7, OPL(2.0, 2.2));
  add('1 1/2 in 1 1/2 out', '8 33', 'back', 8, 6, OPL(1.9, 2.1));
  add('3 1/2 out', '8 07', 'front', 8, 7, OPL(2.0, 2.2));
  add('Half in randy out', '8 15', 'back', 8, 6, OP(1.9, 2.1));
  add('1 1/2 in randy out', '8 35', 'back', 8, 8, OP(2.3, 2.5));
  add('Double full in double full out', '8 44', 'back', 8, 8, { '/': 2.5 });
  add('Half in 3 1/2 out', '8 17', 'back', 8, 8, OP(2.3, 2.5));
  add('2 3/4 front', '11 00', 'front', 11, 0, OPL(1.3, 1.5));
  add('2 3/4 back with half twist', '11 10', 'back', 11, 1, OPL(1.5, 1.7));

  // Triples
  add('Front front half', '12 001', 'front', 12, 1, OP(1.7, 2.0));
  add('Triple back', '12 000', 'back', 12, 0, OPL(1.8, 2.1));
  add('Front front rudy', '12 003', 'front', 12, 3, OP(2.1, 2.4));
  add('Half front half', '12 101', 'back', 12, 2, OP(2.0, 2.3));
  add('Full front half', '12 201', 'front', 12, 3, OP(2.1, 2.4));
  add('Half front rudy', '12 103', 'back', 12, 4, OP(2.6, 2.9));
  add('Front full half', '12 021', 'front', 12, 3, OP(2.1, 2.4));
  add('Half full half', '12 121', 'back', 12, 4, OP(2.6, 2.9));
  add('Full front rudy', '12 203', 'front', 12, 5, OP(2.7, 3.0));
  add('Full full full', '12 222', 'back', 12, 6, { o: 3.2, '/': 3.5 });
  add('Front full rudy', '12 023', 'front', 12, 5, OP(2.7, 3.0));
  add('1 1/2 front rudy out', '12 303', 'back', 12, 6, OP(3.2, 3.5));
  add('Full full half', '12 221', 'front', 12, 5, OP(2.7, 3.0));

  // Quadruples
  add('Front front front half', '16 0001', 'front', 16, 1, OP(2.5, 2.9));
  add('Half in half out quadriffis', '16 1001', 'back', 16, 2, OP(3.1, 3.5));
  add('Front front front rudy', '16 0003', 'front', 16, 3, OP(3.1, 3.5));
  add('Half in rudy out quadriffis', '16 1003', 'back', 16, 4, OP(3.7, 4.1));
  return out;
}

export const OFFICIAL_EXAMPLES: readonly OfficialExample[] = examples();

/** The movement an official example describes, in the units of the element table (somersaults may be a fraction). */
export const exampleMovement = (e: OfficialExample): Movement => ({
  direction: e.quarters === 0 ? null : e.direction,
  somersaults: e.quarters / 4,
  twists: e.halfTwists / 2,
  position: e.position,
});
