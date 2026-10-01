import { jumpName } from '../../coaching/display';
import type { Session } from '../../coaching/session';
import { deductionText, difficultyText } from '../../coaching/summary';

/** What the full screen says about one jump: only the name and the two numbers a coach reads first. */
export interface HudJump {
  name: string;
  /** The classifier is not sure of the name. */
  unsure: boolean;
  /** Difficulty and execution deduction as text; null when they do not count (a guess waiting for a check, nothing named). */
  difficulty: string | null;
  deduction: string | null;
}

/** The jumps of a session, as the full screen shows them. The numbers are the ones of the live rail. */
export function hudJumps(session: Session | null): HudJump[] {
  if (!session) return [];
  return session.jumps.map((j) => ({
    name: jumpName(j),
    unsure: j.source === 'auto' && (j.forced || j.certainty === 'tentative'),
    difficulty: j.element && !j.pending ? difficultyText(j.counted) : null,
    deduction: !j.pending && j.deduction !== null ? deductionText(j.deduction) : null,
  }));
}
