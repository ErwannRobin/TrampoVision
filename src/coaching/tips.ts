import type { JumpFeatures } from '../skills/types';
import type { Deduction, DeductionId, Execution } from './execution';

/**
 * Coaching tips: one per thing that cost points in a skill (the cue that goes with the deduction), plus a note on where the skill
 * landed. Rules only: every tip says what was measured, and what fixing it would earn under the FIG Code of Points.
 */

export type TipId = DeductionId | 'drift' | 'height';

export interface Tip {
  id: TipId;
  /** 0-based jump the tip is about (-1 for the whole set). */
  jump: number;
  /** Points a judge would give back for fixing it (0 when it is not a deduction). */
  gain: number;
  /** Two or three words: "Open earlier". */
  title: string;
  /** The cue, one sentence. */
  text: string;
  /** What was measured. */
  detail: string;
}

const CUES: Record<DeductionId, { title: string; text: string }> = {
  knees: {
    title: 'Straighten the legs',
    text: 'Squeeze the thighs together and push the toes away to lock the knees.',
  },
  opening: {
    title: 'Open earlier',
    text: 'Look for the bed as you pass the top and open the hips sooner: be straight by 1 o’clock.',
  },
  'pike-down': {
    title: 'Stay open',
    text: 'Once you are open, hold the straight body until you are horizontal, then prepare the landing.',
  },
  'body-line': { title: 'Stay long', text: 'Squeeze the glutes and keep the chest up so the hips do not fold.' },
  arms: { title: 'Arms in', text: 'Keep the arms straight and close to the body, hands by the thighs.' },
  'twist-end': {
    title: 'Finish the twist sooner',
    text: 'Start the twist earlier and pull the arms in so it is done before you are horizontal.',
  },
};

function tipOf(jump: number, d: Deduction): Tip {
  const cue =
    d.id === 'opening' && d.label === 'No opening'
      ? {
          title: 'Open before you land',
          text: 'Start opening as soon as you pass the top: stretch out and look for the bed.',
        }
      : CUES[d.id];
  return { id: d.id, jump, gain: d.value, title: cue.title, text: cue.text, detail: d.detail };
}

/** How far from the center of the bed a landing has to be before it is worth a tip (1 is the edge). */
export const DRIFT_BED = 0.5;
/** Without the bed marked: the distance in meters between takeoff and landing that is worth a tip. */
export const DRIFT_M = 0.7;

function driftTip(jump: number, f: JumpFeatures): Tip | null {
  const x = f.trajectory.landingXBed;
  const dx = f.trajectory.horizontalDisplacementM;
  if (x !== null && Number.isFinite(x) && Math.abs(x) >= DRIFT_BED) {
    const side = x > 0 ? 'right' : 'left';
    return {
      id: 'drift',
      jump,
      gain: 0,
      title: 'Land in the center',
      text: 'Keep the shoulders square at takeoff and look at the center of the bed.',
      detail: `Landed ${Math.abs(x) > 1 ? `past the ${side} edge` : `${Math.round(Math.abs(x) * 100)}% of the way to the ${side} edge`} of the bed.`,
    };
  }
  if (x === null && dx !== null && Number.isFinite(dx) && Math.abs(dx) >= DRIFT_M)
    return {
      id: 'drift',
      jump,
      gain: 0,
      title: 'Land in the center',
      text: 'Keep the shoulders square at takeoff and look at the center of the bed.',
      detail: `Travelled ${Math.abs(dx).toFixed(1)} m to the ${dx > 0 ? 'right' : 'left'} in the picture during the skill.`,
    };
  return null;
}

/** The tips of one skill, the ones worth the most first. */
export function tipsForJump(jump: number, execution: Execution | null, features: JumpFeatures): Tip[] {
  const tips = (execution?.items ?? []).map((d) => tipOf(jump, d));
  const drift = features.complete ? driftTip(jump, features) : null;
  if (drift) tips.push(drift);
  return tips.sort((a, b) => b.gain - a.gain);
}

export interface Focus {
  id: TipId;
  title: string;
  text: string;
  /** 0-based jumps it concerns. */
  jumps: number[];
  /** Points that fixing it in all of them would earn. */
  gain: number;
  /** One line: how often and how much. */
  summary: string;
}

const tenths = (v: number) => Math.round(v * 10) / 10;

/** What to work on next, from the tips of a whole set: the things that cost the most points, most often. */
export function focusOf(tips: readonly Tip[], skills: number, limit = 2): Focus[] {
  const groups = new Map<TipId, Tip[]>();
  for (const t of tips) groups.set(t.id, [...(groups.get(t.id) ?? []), t]);
  const out: Focus[] = [];
  for (const [id, list] of groups) {
    const jumps = [...new Set(list.map((t) => t.jump))].filter((j) => j >= 0).sort((a, b) => a - b);
    const gain = tenths(list.reduce((s, t) => s + t.gain, 0));
    // The cue that is given is the one of the skill that lost the most.
    const first = list.reduce((best, t) => (t.gain > best.gain ? t : best), list[0]);
    const of = skills > 0 ? ` of ${skills}` : '';
    out.push({
      id,
      title: first.title,
      text: first.text,
      jumps,
      gain,
      summary:
        jumps.length === 0
          ? first.detail
          : `${jumps.length}${of} ${skills === 1 || jumps.length === 1 ? 'skill' : 'skills'}${gain > 0 ? `, ${gain.toFixed(1)} points` : ''}`,
    });
  }
  return out.sort((a, b) => b.gain - a.gain || b.jumps.length - a.jumps.length).slice(0, limit);
}
