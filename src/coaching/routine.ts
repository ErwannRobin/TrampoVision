import type { LiveJump } from './session';

/**
 * Where the routine starts. Before it the athlete bounces to find the height and the rhythm; the routine is the first skill on, so its
 * start is the takeoff of the first jump that is not a straight jump, or that a person gave an execution point to (they would not score
 * a bounce). A guess the classifier is not sure of only counts when nothing surer exists, so one wrongly named warm-up jump does not
 * start the routine early. Null when no jump qualifies.
 */
export function detectRoutineStart(
  jumps: readonly Pick<LiveJump, 'isSkill' | 'pending' | 'coachDeduction'>[],
): number | null {
  const sure = jumps.findIndex((j) => (j.isSkill && !j.pending) || j.coachDeduction !== null);
  if (sure >= 0) return sure;
  const guess = jumps.findIndex((j) => j.isSkill);
  return guess >= 0 ? guess : null;
}

/** How long before the takeoff of the first skill the routine is said to start, seconds: the athlete is seen coming off the bed. */
export const ROUTINE_LEAD_S = 0.3;

/** The time of the start of the routine: a little before the takeoff of its first jump (never before the clip). */
export function routineStartTime(cycle: { takeoffTimeS: number | null; apexTimeS: number }, clipStartS = 0): number {
  return Math.max(clipStartS, (cycle.takeoffTimeS ?? cycle.apexTimeS) - ROUTINE_LEAD_S);
}

/**
 * What marks the start of the routine: the detected jump (`undefined` here), a jump a person chose, or no mark at all (`null`: the
 * whole clip is the routine).
 */
export type RoutineMark = number | null | undefined;

/** The jump the routine starts at, given what a person chose and what was detected; null when there is none. */
export function routineStartJump(mark: RoutineMark, detected: number | null, jumpCount: number): number | null {
  const k = mark === undefined ? detected : mark;
  return k !== null && k >= 0 && k < jumpCount ? k : null;
}
