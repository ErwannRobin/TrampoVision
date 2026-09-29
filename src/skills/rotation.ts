import type { JumpCycle } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import type { RotationConfig } from './config';
import type { FrameShape } from './frameShape';
import type { RotationEstimate } from './types';

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
/** Below this net rotation the body is not considered to turn in either direction. */
const DIRECTION_MIN_DEG = 45;

/** Linear interpolation of a series at time t; null when a neighbour is missing. */
export function valueAt(time: Float64Array, series: Float64Array, t: number): number | null {
  const n = time.length;
  if (n < 2 || t < time[0] - 1e-9 || t > time[n - 1] + 1e-9) return null;
  const f = ((t - time[0]) / (time[n - 1] - time[0])) * (n - 1);
  const i0 = Math.min(Math.max(Math.floor(f), 0), n - 2);
  const a = series[i0];
  const b = series[i0 + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const w = Math.min(Math.max(f - i0, 0), 1);
  return a + (b - a) * w;
}

/** Samples strictly inside the flight (takeoff..landing) of a complete jump. */
export function flightRange(result: AnalysisResult, cycle: JumpCycle): [number, number] | null {
  if (cycle.takeoffTimeS === null || cycle.landingTimeS === null) return null;
  const { time } = result;
  let from = -1;
  let to = -1;
  for (let i = 0; i < time.length; i++) {
    if (time[i] >= cycle.takeoffTimeS && from < 0) from = i;
    if (time[i] <= cycle.landingTimeS) to = i;
  }
  return from >= 0 && to >= from ? [from, to] : null;
}

const NONE: RotationEstimate = {
  totalDeg: null,
  turns: null,
  direction: 'none',
  nearestDeg: null,
  halfTurns: null,
  residualDeg: null,
  confidence: 0,
  parts: { rounding: 0, coverage: 0, steps: 0, crossCheck: 0, monotonic: 0 },
  maxStepDeg: null,
  crossCheckDiffDeg: null,
  reversalDeg: null,
};

/**
 * How far the body rotated in the air, rounded to half turns, with a confidence.
 *
 * The number comes straight from the continuous trunk orientation: rotation = orientation(landing) -
 * orientation(takeoff). The confidence is the product of four simple checks, each between 0 and 1:
 *  - rounding:   how close the rotation is to a multiple of the step (1 = exactly on it, 0 = `toleranceDeg`
 *                or more away, e.g. a quarter turn that is not a half-turn skill);
 *  - coverage:   how well the four trunk joints were actually measured in the flight (interpolated
 *                samples count 0.6, glitch-corrected 0.4, missing 0);
 *  - steps:      the orientation must not jump by a large angle between two samples (aliasing, pose flips);
 *  - crossCheck: the body line (ankles to head) must have rotated by about the same as the trunk;
 *  - monotonic:  a rotation keeps turning one way. If the orientation goes one way and comes back
 *                (largest move against the net rotation, `reversalDeg`), the athlete did not do that, the
 *                pose model most likely flipped the body, and the net rotation cannot be trusted.
 */
export function estimateRotation(result: AnalysisResult, fs: FrameShape, cycle: JumpCycle, cfg: RotationConfig): RotationEstimate {
  const range = flightRange(result, cycle);
  if (!range || cycle.takeoffTimeS === null || cycle.landingTimeS === null) return NONE;
  const [from, to] = range;
  const { time, orientation } = result;
  const oT = valueAt(time, orientation, cycle.takeoffTimeS);
  const oL = valueAt(time, orientation, cycle.landingTimeS);
  if (oT === null || oL === null) return NONE;

  const totalDeg = oL - oT;
  const nearest = Math.round(Math.abs(totalDeg) / cfg.stepDeg) * cfg.stepDeg;
  const residual = Math.abs(totalDeg) - nearest;

  let coverage = 0;
  let maxStep = 0;
  let count = 0;
  // Largest move against the net direction, in both directions; the smaller one measures the reversal:
  // a clean rotation has one of them near 0, a there-and-back path has both large.
  let runMax = -Infinity;
  let runMin = Infinity;
  let drawdownUp = 0; // (peak so far) - (current): moves against a positive rotation
  let drawdownDown = 0; // (current) - (trough so far): moves against a negative rotation
  for (let i = from; i <= to; i++) {
    if (Number.isFinite(orientation[i])) {
      runMax = Math.max(runMax, orientation[i]);
      runMin = Math.min(runMin, orientation[i]);
      drawdownUp = Math.max(drawdownUp, runMax - orientation[i]);
      drawdownDown = Math.max(drawdownDown, orientation[i] - runMin);
    }
    coverage += Number.isFinite(orientation[i]) ? fs.trunkQuality[i] : 0;
    count++;
    if (i > from && Number.isFinite(orientation[i]) && Number.isFinite(orientation[i - 1])) {
      maxStep = Math.max(maxStep, Math.abs(orientation[i] - orientation[i - 1]));
    }
  }
  coverage = count ? coverage / count : 0;

  const rounding = clamp01(1 - (residual / cfg.toleranceDeg) ** 2);
  const half = 0.5 * cfg.maxStepDeg;
  const steps = maxStep <= half ? 1 : maxStep <= cfg.maxStepDeg ? 1 - 0.5 * ((maxStep - half) / half) : 0.25;

  const lT = valueAt(time, fs.lineOrientation, cycle.takeoffTimeS);
  const lL = valueAt(time, fs.lineOrientation, cycle.landingTimeS);
  let crossCheckDiff: number | null = null;
  let crossCheck = 1;
  if (lT !== null && lL !== null) {
    crossCheckDiff = lL - lT - totalDeg;
    const d = Math.abs(crossCheckDiff);
    crossCheck = d <= 30 ? 1 : d <= 90 ? 1 - 0.6 * ((d - 30) / 60) : 0.3;
  }

  const reversal = Math.min(drawdownUp, drawdownDown);
  const monotonic =
    reversal <= cfg.reversalOkDeg ? 1 : reversal >= cfg.reversalMaxDeg ? 0.2 : 1 - 0.8 * ((reversal - cfg.reversalOkDeg) / (cfg.reversalMaxDeg - cfg.reversalOkDeg));

  const parts = { rounding, coverage, steps, crossCheck, monotonic };
  return {
    totalDeg,
    turns: totalDeg / 360,
    direction: Math.abs(totalDeg) < DIRECTION_MIN_DEG ? 'none' : totalDeg > 0 ? 'clockwise' : 'counterclockwise',
    nearestDeg: nearest,
    halfTurns: nearest / 180,
    residualDeg: residual,
    confidence: rounding * coverage * steps * crossCheck * monotonic,
    parts,
    maxStepDeg: maxStep,
    crossCheckDiffDeg: crossCheckDiff,
    reversalDeg: reversal,
  };
}
