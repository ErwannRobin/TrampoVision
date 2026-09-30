import { median } from '../analysis/signal';
import { t, tp } from '../i18n/core';
import type { Movement } from '../skills/fig/elements';
import { SEQUENCE_COLUMNS } from '../skills/jumpFeatures';
import type { JumpFeatures, JumpSequence, TwistContext } from '../skills/types';
import { CLOCK, DEFAULT_EXECUTION_CONFIG, EXECUTION_RULESET, type ExecutionConfig } from './config';

/**
 * A proposed execution score for one skill: which of the deductions of the FIG Code of Points (Trampoline 2025-2028, Part I §20.2)
 * the measured pose earns. It reads the normalized sequence of the jump (hip, knee, arm and elbow angles, and the rotation, over 32
 * samples from takeoff to landing) and the element that was named, so a coach who corrects the name gets the deductions of the
 * element that was really done.
 *
 * What one side-on camera can tell: bent knees, a late or missing opening, piking down after opening, a bent body line in a layout,
 * arms away from the body, and (when the 3D twist is reliable) a twist that finishes late. What it cannot: feet and knees together,
 * pointed toes. Those are listed as not checked, never guessed. Nothing is judged after 3 o'clock, when the athlete prepares the landing.
 */

export type DeductionId = 'knees' | 'opening' | 'pike-down' | 'body-line' | 'arms' | 'twist-end';

export interface Deduction {
  id: DeductionId;
  /** Short name: "Bent knees". */
  label: string;
  /** The size of the deduction, in points (0.1 to 0.3). */
  value: number;
  /** What was measured, in a sentence. */
  detail: string;
  /** The measurement (null when the event never happened) and the limit it was compared with, for the record and for tuning. */
  measure: { name: string; value: number | null; limit: number; unit: 'deg' | 'clock' };
  /** The article of the Code the deduction comes from. */
  rule: string;
}

export interface Unchecked {
  id: string;
  label: string;
  why: string;
}

export interface Execution {
  /** False when nothing could be judged (`reason` says why). */
  checked: boolean;
  reason: string | null;
  /** Sum of the deductions, at most `maxDeduction`. */
  deduction: number;
  items: Deduction[];
  unchecked: Unchecked[];
  /** 0..1: how much the pose can be trusted over the judged part of the flight. */
  quality: number;
  ruleset: string;
}

export interface ExecutionInput {
  sequence: JumpSequence | null;
  features: JumpFeatures;
  /** The element that was done: the coach's label, else the classifier's guess. */
  movement: Movement;
  /** The 3D twist of the jump, used only when it is reliable. */
  twist?: TwistContext | null;
  config?: ExecutionConfig;
}

const col = (name: string) => SEQUENCE_COLUMNS.indexOf(name);
const COL = { u: col('u'), turns: col('orient_turns'), hip: col('hip_angle_deg'), knee: col('knee_angle_deg') };
const joint = (name: string) => ({ x: col(`${name}_x`), y: col(`${name}_y`) });
const J = {
  shoulder: [joint('left_shoulder'), joint('right_shoulder')],
  elbow: [joint('left_elbow'), joint('right_elbow')],
  wrist: [joint('left_wrist'), joint('right_wrist')],
};

const tenths = (v: number) => Math.round(v * 10) / 10;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const deg = (rad: number) => (rad * 180) / Math.PI;

const uncheckedAlways = (): Unchecked[] => [
  { id: 'feet-knees-toes', label: t('exec.unchecked.feet.label'), why: t('exec.unchecked.feet.why') },
];

/** The hour on the clock (1 to 12) of a position in the last somersault, as the judges say it: 12 o'clock is upside down at the top. */
export function clockHour(g: number): number {
  const hour = Math.round((6 + 12 * g + 12 * 4) % 12);
  return hour === 0 ? 12 : hour;
}
export const clockText = (g: number): string => tp('exec.clock', clockHour(g), { hour: clockHour(g) });

const none = (reason: string, unchecked: Unchecked[] = uncheckedAlways()): Execution => ({
  checked: false,
  reason,
  deduction: 0,
  items: [],
  unchecked,
  quality: 0,
  ruleset: EXECUTION_RULESET,
});

/** Angle at `b` between the segments to `a` and `c`, degrees; NaN when a point is missing. */
function angleAt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v1x = ax - bx;
  const v1y = ay - by;
  const v2x = cx - bx;
  const v2y = cy - by;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!(n > 1e-9)) return NaN;
  return deg(Math.acos(Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / n))));
}

/**
 * The deductions of one skill. `movement.somersaults` places the body on the clock (a somersault is 12 hours, the last one counts);
 * a jump without somersault is judged over the first part of the flight.
 */
export function executionOf(input: ExecutionInput): Execution {
  const cfg = input.config ?? DEFAULT_EXECUTION_CONFIG;
  const { sequence, features, movement } = input;
  if (!features.complete) return none(t('exec.none.cutOff'));
  if (!sequence) return none(t('exec.none.noSequence'));
  const rows = sequence.data;
  const n = rows.length;
  const N = Math.round(movement.somersaults);
  const halfTwists = Math.round(movement.twists * 2);
  const position = movement.position;
  const unchecked = uncheckedAlways();
  if (clamp01(features.quality.pose) < cfg.minQuality) return none(t('exec.none.hardToSee'), unchecked);

  const u = rows.map((r) => r[COL.u]);
  const hip = rows.map((r) => r[COL.hip]);
  const knee = rows.map((r) => r[COL.knee]);
  const turns = rows.map((r) => r[COL.turns]);

  // The body on the clock: the measured rotation scaled to the somersaults of the element (a somersault reads a little short),
  // then measured from the start of the last one.
  let g: number[] | null = null;
  const rotationSure = features.rotation.confidence >= cfg.minRotationConfidence;
  if (N >= 1 && rotationSure) {
    let last = NaN;
    for (let k = n - 1; k >= 0; k--)
      if (Number.isFinite(turns[k])) {
        last = turns[k];
        break;
      }
    const total = Math.abs(last);
    if (total >= cfg.minRotationShare * N && total <= cfg.maxRotationShare * N) {
      const sign = Math.sign(last);
      g = turns.map((turn) => N * ((sign * turn) / total) - (N - 1));
    }
  }

  // The judged part: after the takeoff and before 3 o'clock, where the shape is a position and not a landing preparation.
  const judged: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(hip[k]) || !Number.isFinite(knee[k]) || !(u[k] >= cfg.skipTakeoffU)) continue;
    if (sequence.valid[k] === 0) continue;
    const before = g ? g[k] <= CLOCK.three : u[k] <= (N >= 1 ? 0.75 : cfg.jumpEndU);
    if (before) judged.push(k);
  }
  if (judged.length < cfg.minSamples) return none(t('exec.none.tooLittle'), unchecked);
  const quality = clamp01(features.quality.pose) * Math.min(1, judged.length / (0.5 * n));

  const items: Deduction[] = [];
  const at = (k: number[], series: number[]) => median(k.map((i) => series[i]));

  // Knees (§20.2.1.2): bent knees in the pike and straight positions during the flight.
  if (position !== 'tuck') {
    const k = at(judged, knee);
    if (Number.isFinite(k) && k < cfg.kneeStraightDeg) {
      const value = k < cfg.kneeBentDeg ? 0.2 : 0.1;
      items.push({
        id: 'knees',
        label: t('exec.knees.label'),
        value,
        detail: t(position === 'pike' ? 'exec.knees.detailPike' : 'exec.knees.detailLayout', {
          deg: Math.round(k),
          limit: cfg.kneeStraightDeg,
        }),
        measure: { name: 'knee angle', value: k, limit: cfg.kneeStraightDeg, unit: 'deg' },
        rule: '20.2.1.2',
      });
    }
  }

  // Body line of a layout: the hips should stay open (§20.2.1.5 read for a body that never folds).
  if (position === 'straight') {
    const h = at(judged, hip);
    if (Number.isFinite(h) && h < cfg.layoutHipDeg) {
      const value = h < cfg.layoutHipDeg - cfg.bodyLineDeepMarginDeg ? 0.2 : 0.1;
      items.push({
        id: 'body-line',
        label: t('exec.bodyLine.label'),
        value,
        detail: t('exec.bodyLine.detail', { deg: Math.round(h), limit: cfg.layoutHipDeg }),
        measure: { name: 'hip angle', value: h, limit: cfg.layoutHipDeg, unit: 'deg' },
        rule: '20.2.1.5',
      });
    }
  }

  // Opening (§20.2.1.3) and keeping the body straight after it (§20.2.1.5), for a tuck or a pike.
  if (position !== 'straight' && N >= 1) {
    if (!g) {
      unchecked.push({
        id: 'opening',
        label: t('exec.opening.label'),
        why: t(rotationSure ? 'exec.opening.whyNoClock' : 'exec.opening.whyFlipped'),
      });
    } else {
      let fold = -1;
      for (const k of judged) if (fold < 0 || hip[k] < hip[fold]) fold = k;
      if (hip[fold] > cfg.foldedHipDeg) {
        unchecked.push({
          id: 'opening',
          label: t('exec.opening.label'),
          why: t('exec.opening.whyNoFold'),
        });
      } else {
        // The first time after the deepest fold that the hips are open again, placed by interpolation between two samples.
        let open: number | null = null;
        let openAfter = -1;
        for (let k = fold + 1; k < n; k++) {
          if (!Number.isFinite(hip[k]) || !Number.isFinite(g[k])) continue;
          if (g[k] > CLOCK.three + cfg.clockTolerance) break;
          if (hip[k] >= cfg.openHipDeg) {
            let prev = k - 1;
            while (prev > fold && !Number.isFinite(hip[prev])) prev--;
            const span = hip[k] - hip[prev];
            const frac = span > 0 ? (cfg.openHipDeg - hip[prev]) / span : 1;
            open = g[prev] + frac * (g[k] - g[prev]);
            openAfter = k;
            break;
          }
        }
        const tol = cfg.clockTolerance;
        if (open === null || open > CLOCK.three + tol) {
          items.push({
            id: 'opening',
            label: t('exec.noOpening.label'),
            value: 0.3,
            detail: t('exec.noOpening.detail', { deg: cfg.openHipDeg }),
            measure: { name: 'opening', value: null, limit: CLOCK.one, unit: 'clock' },
            rule: '20.2.1.3',
          });
        } else {
          if (open > CLOCK.one + tol) {
            items.push({
              id: 'opening',
              label: t('exec.lateOpening.label'),
              value: open > CLOCK.two + tol ? 0.2 : 0.1,
              detail: t(open > CLOCK.two + tol ? 'exec.lateOpening.detail23' : 'exec.lateOpening.detail12'),
              measure: { name: 'opening', value: open, limit: CLOCK.one, unit: 'clock' },
              rule: '20.2.1.3',
            });
          }
          const after = judged.filter((k) => k > openAfter);
          if (after.length >= 2) {
            const lowest = Math.min(...after.map((k) => hip[k]));
            if (lowest < cfg.pikeDownMildDeg) {
              items.push({
                id: 'pike-down',
                label: t('exec.pikeDown.label'),
                value: lowest < cfg.pikeDownDeepDeg ? 0.2 : 0.1,
                detail: t('exec.pikeDown.detail', { deg: Math.round(lowest) }),
                measure: { name: 'hip angle after opening', value: lowest, limit: cfg.pikeDownMildDeg, unit: 'deg' },
                rule: '20.2.1.5',
              });
            }
          }
        }
      }
    }
  }

  // Arms of a layout (§20.2.1.1, §13.6): close to the body, straight in the skills of 540° of twist or less.
  if (position === 'straight') {
    const limit = (halfTwists <= 2 ? cfg.armLimitDeg : cfg.armLimitTwistingDeg) + cfg.armMarginDeg;
    const angle: number[] = [];
    const elbow: number[] = [];
    for (const k of judged) {
      const row = rows[k];
      const perArm: number[] = [];
      const flex: number[] = [];
      for (let s = 0; s < 2; s++) {
        const sx = row[J.shoulder[s].x];
        const sy = row[J.shoulder[s].y];
        const ex = row[J.elbow[s].x];
        const ey = row[J.elbow[s].y];
        const wx = row[J.wrist[s].x];
        const wy = row[J.wrist[s].y];
        // Upper arm against the trunk line, 0° = hanging along the body, 90° = out to the side, 180° = overhead.
        if ([sx, sy, ex, ey].every(Number.isFinite)) perArm.push(deg(Math.atan2(Math.abs(ex - sx), -(ey - sy))));
        if ([sx, sy, ex, ey, wx, wy].every(Number.isFinite)) flex.push(angleAt(sx, sy, ex, ey, wx, wy));
      }
      if (perArm.length) angle.push(perArm.reduce((a, b) => a + b, 0) / perArm.length);
      if (flex.length) elbow.push(flex.reduce((a, b) => a + b, 0) / flex.length);
    }
    if (angle.length >= cfg.minSamples) {
      const a = median(angle);
      const e = elbow.length >= cfg.minSamples ? median(elbow) : NaN;
      const away = Number.isFinite(a) && a > limit;
      const bent = halfTwists <= 3 && Number.isFinite(e) && e < cfg.elbowFlexDeg;
      if (away || bent)
        items.push({
          id: 'arms',
          label: t('exec.arms.label'),
          value: 0.1,
          detail: away
            ? t('exec.arms.detailAway', { deg: Math.round(a), limit: limit - cfg.armMarginDeg })
            : t('exec.arms.detailBent', { deg: Math.round(e) }),
          measure: away
            ? { name: 'arm angle', value: a, limit: limit - cfg.armMarginDeg, unit: 'deg' }
            : { name: 'elbow angle', value: e, limit: cfg.elbowFlexDeg, unit: 'deg' },
          rule: '20.2.1.1',
        });
    }
  }

  // End of twisting (§20.2.1.4): more than a full twist in the last somersault that is not finished by 3 o'clock. Only with a trustworthy 3D twist.
  if (N >= 1 && halfTwists > 2) {
    const est = input.twist?.estimate;
    const traj = input.twist?.trajectory;
    if (est?.available && est.reliable && traj && traj.length === n && g) {
      const total = Math.abs(traj[n - 1]);
      const done = traj.findIndex((v) => Number.isFinite(v) && Math.abs(v) >= total - 90);
      if (total >= 270 && done >= 0 && Number.isFinite(g[done]) && g[done] >= CLOCK.three - cfg.clockTolerance) {
        items.push({
          id: 'twist-end',
          label: t('exec.twistEnd.label'),
          value: 0.3,
          detail: t('exec.twistEnd.detail', { clock: clockText(g[done]) }),
          measure: { name: 'twist finish', value: g[done], limit: CLOCK.three, unit: 'clock' },
          rule: '20.2.1.4',
        });
      }
    } else {
      unchecked.push({
        id: 'twist-end',
        label: t('exec.twistEnd.uncheckedLabel'),
        why: t('exec.twistEnd.uncheckedWhy'),
      });
    }
  }

  const deduction = Math.min(cfg.maxDeduction, tenths(items.reduce((s, d) => s + d.value, 0)));
  return { checked: true, reason: null, deduction, items, unchecked, quality, ruleset: EXECUTION_RULESET };
}
