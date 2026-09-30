import {
  MAX_HALF_TWISTS,
  SOMERSAULT_MAX,
  elementById,
  movementToElement,
  type Direction,
} from '../skills/fig/elements';
import type { SkillPrediction } from '../skills/types';
import type { JumpRecord, TruthLabel } from './types';

/**
 * What a person says the jump was, as independent choices: the body position, the direction, the number of somersaults and of
 * half twists. Each is chosen (or left open) on its own, so a jump can be labelled straddle, or back, or 3 half twists, or any
 * combination. The five-way `TruthLabel` and the figure of the element table are both derived from it.
 */

/** Straddle is a position a person can name but the classifier and the element table do not know. */
export const LABEL_POSITIONS = ['straight', 'tuck', 'pike', 'straddle'] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];

export const POSITION_TEXT: Record<LabelPosition, string> = {
  straight: 'Straight',
  tuck: 'Tuck',
  pike: 'Pike',
  straddle: 'Straddle',
};

export interface MovementLabel {
  position: LabelPosition | null;
  /** Only meaningful with at least one somersault. */
  direction: Direction | null;
  somersaults: number;
  halfTwists: number;
}

/** A label with nothing chosen yet: a plain jump without twist. */
export const EMPTY_MOVEMENT: MovementLabel = { position: null, direction: null, somersaults: 0, halfTwists: 0 };

/** The somersault counts a person can pick. */
export const SOMERSAULT_CHOICES: readonly number[] = Array.from({ length: SOMERSAULT_MAX + 1 }, (_, i) => i);

/** The most half twists offered for a number of somersaults: what the element table models. */
export const maxHalfTwists = (somersaults: number): number =>
  MAX_HALF_TWISTS[Math.min(Math.max(Math.round(somersaults), 0), SOMERSAULT_MAX)];

/** Makes a label consistent: no direction without a somersault, and no more half twists than are offered. */
export function normalizeMovement(m: MovementLabel): MovementLabel {
  return {
    position: m.position,
    direction: m.somersaults > 0 ? m.direction : null,
    somersaults: m.somersaults,
    halfTwists: Math.min(m.halfTwists, maxHalfTwists(m.somersaults)),
  };
}

/** Everything that is needed to say what the jump was has been chosen. */
export const isComplete = (m: MovementLabel): boolean =>
  m.position !== null && (m.somersaults === 0 || m.direction !== null);

/**
 * The five-way label the metrics use: back or front for a somersault, otherwise the position. What is not one of the five (a
 * straddle, or a label that is not finished) is "unknown", which is what the classifier is expected to leave unclassified.
 */
export function legacyLabel(m: MovementLabel): TruthLabel {
  if (m.somersaults > 0) return m.direction ?? 'unknown';
  return m.position === 'straight' || m.position === 'tuck' || m.position === 'pike' ? m.position : 'unknown';
}

/** The element of the table the label names, or null when it is unfinished, a straddle, or not in the table. */
export function figureOf(m: MovementLabel): string | null {
  if (!isComplete(m) || m.position === 'straddle' || m.position === null) return null;
  return (
    movementToElement({
      direction: m.somersaults > 0 ? m.direction : null,
      somersaults: m.somersaults,
      twists: m.halfTwists / 2,
      position: m.position,
    })?.id ?? null
  );
}

/** The label that says what the classifier predicted; null when it named no movement. */
export function movementFromPrediction(p: Pick<SkillPrediction, 'movement'>): MovementLabel | null {
  const m = p.movement;
  if (!m) return null;
  return normalizeMovement({
    position: m.position,
    direction: m.direction,
    somersaults: m.somersaults,
    halfTwists: Math.round(m.twists * 2),
  });
}

/** What a saved record says the jump was: its movement label, else its figure, else the five-way label; null when unlabelled. */
export function movementOfRecord(r: JumpRecord): MovementLabel | null {
  if (r.truth?.movement) return r.truth.movement;
  const element = r.figure ? elementById(r.figure.elementId) : undefined;
  if (element) {
    return normalizeMovement({
      position: element.position,
      direction: element.direction,
      somersaults: element.somersaults,
      halfTwists: Math.round(element.twists * 2),
    });
  }
  switch (r.truth?.label) {
    case 'straight':
    case 'tuck':
    case 'pike':
      return { ...EMPTY_MOVEMENT, position: r.truth.label };
    case 'back':
    case 'front':
      return { ...EMPTY_MOVEMENT, direction: r.truth.label, somersaults: 1 };
    default:
      return null;
  }
}

const twistText = (h: number): string =>
  h === 1 ? '½ twist' : h === 2 ? 'full twist' : h % 2 === 0 ? `${h / 2} twists` : `${(h - 1) / 2}½ twists`;

/** One line for the label: "Back double somersault, full twist, tuck". */
export function describeMovement(m: MovementLabel): string {
  const parts: string[] = [];
  if (m.somersaults > 0) {
    const name = ['', 'somersault', 'double somersault', 'triple somersault'][m.somersaults];
    parts.push(m.direction ? `${m.direction[0].toUpperCase()}${m.direction.slice(1)} ${name}` : name);
  } else if (m.position) {
    parts.push(`${POSITION_TEXT[m.position]} jump`);
  }
  if (m.halfTwists > 0) parts.push(twistText(m.halfTwists));
  if (m.somersaults > 0 && m.position) parts.push(m.position);
  return parts.join(', ');
}
