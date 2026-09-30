import type { JumpCycle } from '../analysis/jumpCycles';
import { formatPercent, t, tp } from '../i18n/core';
import type { WorldPoint } from '../pose/types';
import type { Limitation } from '../skills/types';
import { mergeTwistConfig, type TwistConfig } from './config';
import { computeTorsoFrames, lateralPerp, vectorAt, type TorsoFrames } from './torso';
import { cross, dot, finite3, perpendicular, signedAngleDeg, transport, unit, type Vec3 } from './vec3';

/**
 * Twist = rotation of the body about its own longitudinal axis (hips to shoulders), as opposed to the somersault, which
 * turns the axis itself. It is read from the 3D landmarks, frame by frame, as the spin of the shoulder line (and of the hip
 * line) about the moving axis:
 *
 *   1. carry the lateral line of the previous frame along with the axis by the smallest rotation (so a somersault adds nothing),
 *   2. the signed angle between that carried line and the line of this frame, about the axis, is the twist of this step,
 *   3. the steps are summed: the accumulated twist. Net twist of a jump = accumulated at landing - accumulated at takeoff.
 *
 * A second estimate uses the axis projected into the image plane instead of the true 3D axis. It cannot be fooled by a small
 * depth error of the axis (which turns a somersault into a phantom twist), but it is blind to a real tilt of the trunk out of
 * the image plane. When the two disagree, the result depends on a depth value the model estimates poorly, and the
 * confidence says so.
 *
 * Sign: + = counter-clockwise seen from above the head (the athlete turns toward their left), assuming the model's world
 * axes are right-handed. That assumption is not verified on real footage.
 */

export interface TwistFrames {
  torso: TorsoFrames;
  /** Accumulated twist in degrees since the first usable sample: the mean of the shoulder and hip estimates about the full 3D axis. NaN where the torso is unknown. */
  angle: Float64Array;
  angleShoulders: Float64Array;
  angleHips: Float64Array;
  /** Same with the axis projected into the image plane (see above). */
  anglePlane: Float64Array;
  /** Twist speed in deg/s, smoothed. */
  angularVelocity: Float64Array;
  /** Twist of each step before folding, degrees (NaN = unknown). Large values are label swaps or aliasing. */
  rawStep: Float64Array;
  /** 1 where a step above the limit was folded back (probable left/right swap). */
  flip: Uint8Array;
}

export type TwistDirection = 'positive' | 'negative' | 'none';

export interface TwistEstimate {
  /** 3D landmarks with a usable torso exist for this flight. */
  available: boolean;
  /** Net twist between takeoff and landing, degrees (+ = counter-clockwise seen from above the head). */
  totalDeg: number | null;
  direction: TwistDirection;
  /** |twist| rounded to a multiple of the step (180: half twists). */
  nearestDeg: number | null;
  halfTwists: number | null;
  /** Estimated number of twists (a full twist = 360 degrees = 2 half twists). */
  twists: number | null;
  residualDeg: number | null;
  peakAngularVelocityDps: number | null;
  meanAbsAngularVelocityDps: number | null;
  /** Product of the parts below, 0..1: internal consistency of the measurement, NOT a probability of being right. */
  confidence: number;
  /** confidence >= the configured minimum. Otherwise the number must not be presented as a measurement. */
  reliable: boolean;
  parts: {
    rounding: number;
    coverage: number;
    steps: number;
    monotonic: number;
    shoulderHip: number;
    axisDepth: number;
    depth: number;
  };
  /** The same net twist by other routes: shoulder line only, hip line only, image-plane axis. */
  cross: { shouldersDeg: number | null; hipsDeg: number | null; inPlaneAxisDeg: number | null };
  /** Variation (std / mean) of the 3D shoulder width during the flight. */
  shoulderWidthCv: number | null;
  /** Steps folded back as probable left/right swaps. */
  flips: number;
  maxStepDeg: number | null;
  reversalDeg: number | null;
  /** Mean angle of the trunk axis out of the image plane during the flight, degrees. */
  axisTiltDeg: number | null;
  /** Share of the flight where the shoulder line points along the viewing direction (twist then only shows through depth). */
  shoulderDepthShare: number | null;
  limitations: Limitation[];
}

export interface TwistAnalysis {
  config: TwistConfig;
  /** Null when the pose data has no 3D landmarks. */
  frames: TwistFrames | null;
  jumps: TwistEstimate[];
}

export interface TwistInput {
  world?: (WorldPoint[] | null)[];
  time: ArrayLike<number>;
  fps: number;
  cycles: Pick<JumpCycle, 'takeoff' | 'landing' | 'takeoffTimeS' | 'landingTimeS' | 'complete'>[];
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const ramp = (v: number, ok: number, max: number, floor: number) =>
  v <= ok ? 1 : v >= max ? floor : 1 - (1 - floor) * ((v - ok) / (max - ok));
const foldHalf = (d: number) => d - 180 * Math.round(d / 180);
const wrap180 = (d: number) => d - 360 * Math.round(d / 360);

/** Per-sample twist steps of one lateral line about the true 3D axis (mode 'full') or the image-plane axis (mode 'plane'). */
function stepsOf(t: TorsoFrames, line: 'shoulders' | 'hips', mode: 'full' | 'plane'): Float64Array {
  const out = new Float64Array(t.count).fill(NaN);
  if (mode === 'full') {
    for (let i = 1; i < t.count; i++) {
      if (!t.valid[i] || !t.valid[i - 1]) continue;
      const a = lateralPerp(t, line, i - 1);
      const b = lateralPerp(t, line, i);
      if (!a || !b) continue;
      const u0 = vectorAt(t.axis, i - 1);
      const u1 = vectorAt(t.axis, i);
      const carried = transport(a, u0, u1);
      if (!carried) continue;
      const c = unit(perpendicular(carried, u1));
      if (!finite3(c)) continue;
      out[i] = signedAngleDeg(c, b, u1);
    }
    return out;
  }
  // Image-plane axis: the angle of the line inside the plane perpendicular to the projected axis, from e1 = z x axis toward e2 = z.
  const angle = new Float64Array(t.count).fill(NaN);
  const z: Vec3 = [0, 0, 1];
  for (let i = 0; i < t.count; i++) {
    if (!t.valid[i]) continue;
    const l = vectorAt(t[line], i);
    const u = vectorAt(t.axis, i);
    if (!finite3(l) || !finite3(u)) continue;
    const a = unit([u[0], u[1], 0]);
    if (!finite3(a) || Math.hypot(u[0], u[1]) < 0.3) continue;
    const e1 = cross(z, a);
    angle[i] = (Math.atan2(dot(l, z), dot(l, e1)) * 180) / Math.PI;
  }
  for (let i = 1; i < t.count; i++)
    if (Number.isFinite(angle[i]) && Number.isFinite(angle[i - 1])) out[i] = wrap180(angle[i] - angle[i - 1]);
  return out;
}

/** Steps above the limit are folded into (-90, 90] (a probable left/right swap). Returns the folded steps and marks the flips. */
function fold(raw: Float64Array, limit: number, flips: Uint8Array): Float64Array {
  const out = new Float64Array(raw.length).fill(NaN);
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i];
    if (!Number.isFinite(d)) continue;
    if (Math.abs(d) > limit) {
      out[i] = foldHalf(d);
      flips[i] = 1;
    } else out[i] = d;
  }
  return out;
}

const meanOfFinite = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : Number.isFinite(b) ? b : NaN;

/** Sum of the steps; where a step is unknown the angle stays where it was. NaN where the torso itself is unknown. */
function cumulate(step: Float64Array, valid: Uint8Array): Float64Array {
  const out = new Float64Array(step.length).fill(NaN);
  let acc = 0;
  for (let i = 0; i < step.length; i++) {
    if (!valid[i]) continue;
    if (Number.isFinite(step[i])) acc += step[i];
    out[i] = acc;
  }
  return out;
}

/** Twist over the whole clip, sample by sample. */
export function computeTwistFrames(world: (WorldPoint[] | null)[], fps: number, cfg: TwistConfig): TwistFrames {
  const torso = computeTorsoFrames(world, fps, cfg);
  const n = torso.count;
  const flip = new Uint8Array(n);
  const dummy = new Uint8Array(n);
  const rawS = stepsOf(torso, 'shoulders', 'full');
  const rawH = stepsOf(torso, 'hips', 'full');
  const rawP1 = stepsOf(torso, 'shoulders', 'plane');
  const rawP2 = stepsOf(torso, 'hips', 'plane');
  // A flip is decided per line; the marks of the primary estimate (shoulders and hips) are kept.
  const sS = fold(rawS, cfg.maxStepDeg, flip);
  const sH = fold(rawH, cfg.maxStepDeg, flip);
  const sP1 = fold(rawP1, cfg.maxStepDeg, dummy);
  const sP2 = fold(rawP2, cfg.maxStepDeg, dummy);
  const step = new Float64Array(n).fill(NaN);
  const stepPlane = new Float64Array(n).fill(NaN);
  const rawStep = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    step[i] = meanOfFinite(sS[i], sH[i]);
    stepPlane[i] = meanOfFinite(sP1[i], sP2[i]);
    const a = rawS[i];
    const b = rawH[i];
    rawStep[i] =
      Number.isFinite(a) && Number.isFinite(b) ? (Math.abs(a) >= Math.abs(b) ? a : b) : Number.isFinite(a) ? a : b;
  }
  const angle = cumulate(step, torso.valid);
  const angleShoulders = cumulate(sS, torso.valid);
  const angleHips = cumulate(sH, torso.valid);
  const anglePlane = cumulate(stepPlane, torso.valid);

  // Smoothed twist speed.
  const half = Math.max(1, Math.round((cfg.velocitySmoothS * fps) / 2));
  const angularVelocity = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      if (Number.isFinite(step[k])) {
        sum += step[k];
        count++;
      }
    }
    if (count && torso.valid[i]) angularVelocity[i] = (sum / count) * fps;
  }
  return { torso, angle, angleShoulders, angleHips, anglePlane, angularVelocity, rawStep, flip };
}

/** Value of a series at time t: linear between the two neighbours, or the one that exists. */
function at(series: Float64Array, time: ArrayLike<number>, t: number): number | null {
  const n = time.length;
  if (n < 2 || t < time[0] - 1e-9 || t > time[n - 1] + 1e-9) return null;
  let i = 0;
  while (i < n - 2 && time[i + 1] <= t) i++;
  const a = series[i];
  const b = series[i + 1];
  const w = clamp01((t - time[i]) / (time[i + 1] - time[i] || 1));
  if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * w;
  if (Number.isFinite(a) && w < 0.5) return a;
  if (Number.isFinite(b) && w >= 0.5) return b;
  return null;
}

const UNAVAILABLE = (why: Limitation): TwistEstimate => ({
  available: false,
  totalDeg: null,
  direction: 'none',
  nearestDeg: null,
  halfTwists: null,
  twists: null,
  residualDeg: null,
  peakAngularVelocityDps: null,
  meanAbsAngularVelocityDps: null,
  confidence: 0,
  reliable: false,
  parts: { rounding: 0, coverage: 0, steps: 0, monotonic: 0, shoulderHip: 0, axisDepth: 0, depth: 0 },
  cross: { shouldersDeg: null, hipsDeg: null, inPlaneAxisDeg: null },
  shoulderWidthCv: null,
  flips: 0,
  maxStepDeg: null,
  reversalDeg: null,
  axisTiltDeg: null,
  shoulderDepthShare: null,
  limitations: [why],
});

/** What is missing when there are no 3D landmarks, in the language in use. */
export const no3d = (): Limitation => ({
  id: 'no-3d',
  signal: t('tw.signal.pose3d'),
  problem: t('tw.no3d.problem'),
  needed: t('tw.no3d.needed'),
});

const pct = (v: number) => formatPercent(v);
const deg = (v: number | null) => (v === null ? '–' : `${Math.round(v)}°`);

/** Net twist of one flight with the checks that say how far it can be trusted. */
export function estimateTwistForJump(
  frames: TwistFrames,
  time: ArrayLike<number>,
  cycle: TwistInput['cycles'][number],
  cfg: TwistConfig,
): TwistEstimate {
  const { torso } = frames;
  if (
    !cycle.complete ||
    cycle.takeoff === null ||
    cycle.landing === null ||
    cycle.takeoffTimeS === null ||
    cycle.landingTimeS === null
  ) {
    return UNAVAILABLE({
      id: 'cut-off',
      signal: t('tw.signal.twist'),
      problem: t('tw.cutOff.problem'),
      needed: t('tw.cutOff.needed'),
    });
  }
  const from = cycle.takeoff;
  const to = cycle.landing;
  let anyValid = false;
  for (let i = from; i <= to; i++) if (torso.valid[i]) anyValid = true;
  if (!anyValid) {
    return UNAVAILABLE({
      id: 'torso-not-found',
      signal: t('tw.signal.pose3d'),
      problem: t('tw.notFound.problem'),
      needed: t('tw.notFound.needed'),
    });
  }

  const total = (series: Float64Array) => {
    const a = at(series, time, cycle.takeoffTimeS!);
    const b = at(series, time, cycle.landingTimeS!);
    return a !== null && b !== null ? b - a : null;
  };
  const totalDeg = total(frames.angle);
  const shouldersDeg = total(frames.angleShoulders);
  const hipsDeg = total(frames.angleHips);
  const planeDeg = total(frames.anglePlane);
  if (totalDeg === null) {
    return UNAVAILABLE({
      id: 'torso-unknown',
      signal: t('tw.signal.twist'),
      problem: t('tw.torsoUnknown.problem'),
      needed: t('tw.torsoUnknown.needed'),
    });
  }

  // Measurements over the flight.
  let coverage = 0;
  let maxStep = 0;
  let flips = 0;
  let runMax = -Infinity;
  let runMin = Infinity;
  let downUp = 0;
  let downDown = 0;
  let peakVel = 0;
  let sumVel = 0;
  let nVel = 0;
  let tilt = 0;
  let nTilt = 0;
  let depthShare = 0;
  let nDepth = 0;
  const widths: number[] = [];
  const count = to - from + 1;
  for (let i = from; i <= to; i++) {
    const measured = torso.measured[i] === 1 && Number.isFinite(frames.rawStep[i]);
    coverage += measured ? 1 : torso.valid[i] ? 0.6 : 0;
    if (i > from) {
      if (Number.isFinite(frames.rawStep[i])) maxStep = Math.max(maxStep, Math.abs(frames.rawStep[i]));
      flips += frames.flip[i];
    }
    const a = frames.angle[i];
    if (Number.isFinite(a)) {
      runMax = Math.max(runMax, a);
      runMin = Math.min(runMin, a);
      downUp = Math.max(downUp, runMax - a);
      downDown = Math.max(downDown, a - runMin);
    }
    const w = frames.angularVelocity[i];
    if (Number.isFinite(w)) {
      peakVel = Math.max(peakVel, Math.abs(w));
      sumVel += Math.abs(w);
      nVel++;
    }
    if (torso.measured[i]) {
      if (Number.isFinite(torso.axisTiltDeg[i])) {
        tilt += torso.axisTiltDeg[i];
        nTilt++;
      }
      if (Number.isFinite(torso.shoulderWidthM[i])) widths.push(torso.shoulderWidthM[i]);
      if (Number.isFinite(torso.shoulderDepthShare[i])) {
        depthShare += torso.shoulderDepthShare[i] > 0.8 ? 1 : 0;
        nDepth++;
      }
    }
  }
  coverage /= count;
  const reversal = Math.min(downUp, downDown);
  let cv: number | null = null;
  if (widths.length >= 4) {
    const m = widths.reduce((s, v) => s + v, 0) / widths.length;
    cv = Math.sqrt(widths.reduce((s, v) => s + (v - m) ** 2, 0) / widths.length) / m;
  }

  const nearest = Math.round(Math.abs(totalDeg) / cfg.stepDeg) * cfg.stepDeg;
  const residual = Math.abs(totalDeg) - nearest;
  const half = 0.5 * cfg.maxStepDeg;
  const parts = {
    rounding: clamp01(1 - (residual / cfg.toleranceDeg) ** 2),
    coverage: clamp01(coverage),
    steps: flips > 0 ? Math.max(0.15, 0.5 ** flips) : maxStep <= half ? 1 : 1 - 0.4 * clamp01((maxStep - half) / half),
    monotonic: ramp(reversal, cfg.reversalOkDeg, cfg.reversalMaxDeg, 0.2),
    shoulderHip:
      shouldersDeg !== null && hipsDeg !== null
        ? ramp(Math.abs(shouldersDeg - hipsDeg), cfg.agreeOkDeg, cfg.agreeMaxDeg, 0.1)
        : 0.7,
    axisDepth: planeDeg !== null ? ramp(Math.abs(totalDeg - planeDeg), cfg.agreeOkDeg, cfg.agreeMaxDeg, 0.1) : 0.7,
    depth: cv !== null ? ramp(cv, cfg.widthCvOk, cfg.widthCvMax, 0.1) : 0.7,
  };
  const confidence = Object.values(parts).reduce((p, v) => p * v, 1);

  const limitations: Limitation[] = [];
  if (parts.coverage < 0.75) {
    limitations.push({
      id: 'coverage',
      signal: t('tw.coverage.signal'),
      problem: t('tw.coverage.problem', { share: pct(coverage) }),
      needed: t('tw.coverage.needed'),
    });
  }
  if (parts.axisDepth < 0.8 && planeDeg !== null) {
    limitations.push({
      id: 'axis-depth',
      signal: t('tw.axis.signal'),
      problem: t('tw.axis.problem', { total: deg(totalDeg), plane: deg(planeDeg) }),
      needed: t('tw.axis.needed'),
    });
  }
  if (parts.shoulderHip < 0.8 && shouldersDeg !== null && hipsDeg !== null) {
    limitations.push({
      id: 'shoulders-hips',
      signal: t('tw.shoulderHip.signal'),
      problem: t('tw.shoulderHip.problem', { shoulders: deg(shouldersDeg), hips: deg(hipsDeg) }),
      needed: t('tw.shoulderHip.needed'),
    });
  }
  if (cv !== null && parts.depth < 0.8) {
    limitations.push({
      id: 'depth-consistency',
      signal: t('tw.depth.signal'),
      problem: t('tw.depth.problem', { cv: pct(cv) }),
      needed: t('tw.depth.needed'),
    });
  }
  if (flips > 0) {
    limitations.push({
      id: 'swaps',
      signal: t('tw.swaps.signal'),
      problem: tp('tw.swaps.problem', flips, { max: cfg.maxStepDeg, largest: deg(maxStep) }),
      needed: t('tw.swaps.needed'),
    });
  } else if (parts.steps < 0.9) {
    limitations.push({
      id: 'frame-rate',
      signal: t('tw.rate.signal'),
      problem: t('tw.rate.problem', { largest: deg(maxStep), max: cfg.maxStepDeg }),
      needed: t('tw.rate.needed'),
    });
  }
  if (parts.monotonic < 0.8) {
    limitations.push({
      id: 'direction',
      signal: t('tw.direction.signal'),
      problem: t('tw.direction.problem', { reversal: deg(reversal) }),
      needed: t('tw.direction.needed'),
    });
  }
  if (parts.rounding < 0.5) {
    limitations.push({
      id: 'rounding',
      signal: t('tw.rounding.signal'),
      problem: t('tw.rounding.problem', { total: deg(Math.abs(totalDeg)), off: deg(Math.abs(residual)) }),
      needed: t('tw.rounding.needed'),
    });
  }
  const depthDominated = nDepth ? depthShare / nDepth : null;
  if (depthDominated !== null && depthDominated > 0.5) {
    limitations.push({
      id: 'side-view',
      signal: t('tw.side.signal'),
      problem: t('tw.side.problem', { share: pct(depthDominated) }),
      needed: t('tw.side.needed'),
    });
  }

  return {
    available: true,
    totalDeg,
    direction: Math.abs(totalDeg) < cfg.directionMinDeg ? 'none' : totalDeg > 0 ? 'positive' : 'negative',
    nearestDeg: nearest,
    halfTwists: nearest / 180,
    twists: nearest / 360,
    residualDeg: residual,
    peakAngularVelocityDps: nVel ? peakVel : null,
    meanAbsAngularVelocityDps: nVel ? sumVel / nVel : null,
    confidence,
    reliable: confidence >= cfg.minConfidence,
    parts,
    cross: { shouldersDeg, hipsDeg, inPlaneAxisDeg: planeDeg },
    shoulderWidthCv: cv,
    flips,
    maxStepDeg: maxStep,
    reversalDeg: reversal,
    axisTiltDeg: nTilt ? tilt / nTilt : null,
    shoulderDepthShare: depthDominated,
    limitations,
  };
}

/** Twist over the whole clip and one estimate per jump. Without 3D landmarks every jump gets an "unavailable" estimate that says why. */
export function analyzeTwist(input: TwistInput, options: { config?: Partial<TwistConfig> } = {}): TwistAnalysis {
  const config = mergeTwistConfig(options.config);
  if (!input.world || input.world.length === 0 || input.world.every((f) => f === null)) {
    return { config, frames: null, jumps: input.cycles.map(() => UNAVAILABLE(no3d())) };
  }
  const frames = computeTwistFrames(input.world, input.fps, config);
  return { config, frames, jumps: input.cycles.map((c) => estimateTwistForJump(frames, input.time, c, config)) };
}

/** The twist of one flight resampled on the normalized time axis (0 = takeoff, 1 = landing), like the 2D jump sequence. */
export interface TwistSequence {
  samples: number;
  columns: string[];
  /** Rows = samples; NaN where unknown. Twist angles are relative to the takeoff. */
  data: number[][];
}

export const TWIST_SEQUENCE_COLUMNS = [
  'u',
  'twist_deg',
  'twist_plane_axis_deg',
  'twist_velocity_dps',
  'axis_tilt_deg',
  'shoulder_width_m',
];

export function twistSequence(
  frames: TwistFrames,
  time: ArrayLike<number>,
  cycle: TwistInput['cycles'][number],
  samples: number,
): TwistSequence | null {
  if (!cycle.complete || cycle.takeoffTimeS === null || cycle.landingTimeS === null) return null;
  const t0 = cycle.takeoffTimeS;
  const dur = cycle.landingTimeS - t0;
  const base = at(frames.angle, time, t0);
  const basePlane = at(frames.anglePlane, time, t0);
  const data: number[][] = [];
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1);
    const t = t0 + u * dur;
    const v = (series: Float64Array) => at(series, time, t) ?? NaN;
    data.push([
      u,
      base === null ? NaN : v(frames.angle) - base,
      basePlane === null ? NaN : v(frames.anglePlane) - basePlane,
      v(frames.angularVelocity),
      v(frames.torso.axisTiltDeg),
      v(frames.torso.shoulderWidthM),
    ]);
  }
  return { samples, columns: TWIST_SEQUENCE_COLUMNS, data };
}
