import { formatNumber, formatPercent, t, tp } from '../i18n/core';
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

const CUES = {
  knees: ['tip.knees.title', 'tip.knees.text'],
  opening: ['tip.opening.title', 'tip.opening.text'],
  'pike-down': ['tip.pikeDown.title', 'tip.pikeDown.text'],
  'body-line': ['tip.bodyLine.title', 'tip.bodyLine.text'],
  arms: ['tip.arms.title', 'tip.arms.text'],
  'twist-end': ['tip.twistEnd.title', 'tip.twistEnd.text'],
} as const;

function tipOf(jump: number, d: Deduction): Tip {
  // An opening that never happened (its measure is empty) has its own cue.
  const [title, text] =
    d.id === 'opening' && d.measure.value === null
      ? (['tip.noOpening.title', 'tip.noOpening.text'] as const)
      : CUES[d.id];
  return { id: d.id, jump, gain: d.value, title: t(title), text: t(text), detail: d.detail };
}

/** How far from the center of the bed a landing has to be before it is worth a tip (1 is the edge). */
export const DRIFT_BED = 0.5;
/** Without the bed marked: the distance in meters between takeoff and landing that is worth a tip. */
export const DRIFT_M = 0.7;

function driftTip(jump: number, f: JumpFeatures): Tip | null {
  const x = f.trajectory.landingXBed;
  const dx = f.trajectory.horizontalDisplacementM;
  if (x !== null && Number.isFinite(x) && Math.abs(x) >= DRIFT_BED) {
    const side = x > 0 ? t('side.right') : t('side.left');
    return {
      id: 'drift',
      jump,
      gain: 0,
      title: t('tip.drift.title'),
      text: t('tip.drift.text'),
      detail:
        Math.abs(x) > 1
          ? t('tip.drift.pastEdge', { side })
          : t('tip.drift.towardEdge', { share: formatPercent(Math.abs(x)), side }),
    };
  }
  if (x === null && dx !== null && Number.isFinite(dx) && Math.abs(dx) >= DRIFT_M)
    return {
      id: 'drift',
      jump,
      gain: 0,
      title: t('tip.drift.title'),
      text: t('tip.drift.text'),
      detail: t('tip.drift.travelled', {
        dist: formatNumber(Math.abs(dx), 1),
        side: dx > 0 ? t('side.right') : t('side.left'),
      }),
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
  for (const tip of tips) groups.set(tip.id, [...(groups.get(tip.id) ?? []), tip]);
  const out: Focus[] = [];
  for (const [id, list] of groups) {
    const jumps = [...new Set(list.map((tip) => tip.jump))].filter((j) => j >= 0).sort((a, b) => a - b);
    const gain = tenths(list.reduce((s, tip) => s + tip.gain, 0));
    // The cue that is given is the one of the skill that lost the most.
    const first = list.reduce((best, tip) => (tip.gain > best.gain ? tip : best), list[0]);
    const count = skills > 0 ? tp('focus.of', jumps.length, { total: skills }) : tp('focus.count', jumps.length);
    out.push({
      id,
      title: first.title,
      text: first.text,
      jumps,
      gain,
      summary:
        jumps.length === 0
          ? first.detail
          : gain > 0
            ? t('focus.withGain', { count, gain: tp('unit.points', gain, { n: formatNumber(gain, 1) }) })
            : count,
    });
  }
  return out.sort((a, b) => b.gain - a.gain || b.jumps.length - a.jumps.length).slice(0, limit);
}
