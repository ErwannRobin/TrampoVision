import { elementById, movementToElement, type FigElement } from '../skills/fig/elements';
import type { Certainty, SkillPrediction } from '../skills/types';

/**
 * What the app says a jump was: always an element of the table when the jump is complete. The classifier is asked to guess (see
 * `SkillConfig.forceGuess`), so this mostly reads its answer; it also reads what the classifier left behind before it guessed
 * (records saved earlier, a somersault of unknown direction, an unclassified jump with candidates), so an old dataset works too.
 */

/** A prediction at or above this is called confident (the line the video labels and the timeline draw). */
const CONFIDENT = 0.6;
const MIN = 0.3;
/** Data quality (pose, camera view, orientation track) under which the rotation itself is in doubt. */
const UNRELIABLE = 0.3;

export interface Alternative {
  elementId: string;
  name: string;
  difficulty: number;
  /** 0..1, comparable within one jump only. */
  score: number;
}

export interface Call {
  element: FigElement;
  confidence: number;
  certainty: Certainty;
  /** The classifier would not have named it: the closest element of the table, with the reason it is weak in the prediction. */
  forced: boolean;
  /** Front or back could not be told apart and the likelier direction is given. */
  directionAssumed: boolean;
  alternatives: Alternative[];
}

const certaintyOf = (p: SkillPrediction): Certainty =>
  p.certainty ?? (p.confidence >= CONFIDENT ? 'confident' : p.confidence >= MIN ? 'probable' : 'tentative');

function alternativesOf(
  p: SkillPrediction,
  chosen: FigElement,
  directionAssumed: boolean,
  limit: number,
): Alternative[] {
  const out: Alternative[] = [];
  const add = (elementId: string, score: number) => {
    const e = elementById(elementId);
    if (!e || e.id === chosen.id || out.some((a) => a.elementId === e.id)) return;
    out.push({ elementId: e.id, name: e.name, difficulty: e.difficulty, score });
  };
  // A pose that could not be trusted (a body that seems to flip) can turn a plain jump into a somersault: the same shape without rotation is
  // offered first.
  if (chosen.somersaults > 0 && (p.dataQuality ?? 1) < UNRELIABLE) {
    const jump = movementToElement({ direction: null, somersaults: 0, twists: 0, position: chosen.position });
    if (jump) add(jump.id, 0.99);
  }
  // When the direction was assumed, the same movement the other way round is the first thing to offer.
  if (directionAssumed && chosen.direction) {
    const twin = movementToElement({ ...chosen, direction: chosen.direction === 'back' ? 'front' : 'back' });
    if (twin) add(twin.id, (p.candidates?.find((c) => c.elementId === twin.id)?.score ?? 0) || p.confidence);
  }
  for (const c of p.candidates ?? []) add(c.elementId, c.score ?? c.posterior);
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The call for a complete jump, or null when there is nothing to go on (the jump is cut off, or the prediction has no candidate). */
export function callOf(p: SkillPrediction, alternatives = 4): Call | null {
  let element = p.elementId ? elementById(p.elementId) : undefined;
  let directionAssumed = p.guess?.direction ?? false;
  let forced = p.guess?.closest ?? false;
  if (!element && p.movement) {
    // A somersault of unknown direction (records saved before the classifier guessed): back is the commoner.
    element = movementToElement({ ...p.movement, direction: p.movement.somersaults > 0 ? 'back' : null }) ?? undefined;
    directionAssumed = p.movement.somersaults > 0;
  }
  if (!element && p.candidates?.length) {
    element = elementById(p.candidates[0].elementId);
    forced = true;
  }
  if (!element) return null;
  return {
    element,
    confidence: p.confidence,
    certainty: forced ? 'tentative' : certaintyOf(p),
    forced,
    directionAssumed,
    alternatives: alternativesOf(p, element, directionAssumed, alternatives),
  };
}
