import { CORE_LANDMARKS, LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { skeletonLength } from './geometry';
import { fillGaps, localPolyFit, median, oddWindow, spikeMask } from './signal';
import type { PoseTrack } from './types';

/** How a landmark position was obtained in a given sample. */
export const JOINT_STATE = { missing: 0, measured: 1, interpolated: 2, corrected: 3 } as const;
export const JOINT_STATE_NAMES = ['missing', 'measured', 'interpolated', 'corrected'] as const;
export type JointStateName = (typeof JOINT_STATE_NAMES)[number];

export interface StabilizeOptions {
  /** Landmarks below this model visibility are treated as missing. */
  minVisibility: number;
  /** Width of the smoothing window, seconds. */
  smoothS: number;
  /** Longest gap (seconds) that is bridged by interpolation. Longer gaps stay missing. */
  maxGapS: number;
  /** A landmark farther than this fraction of the body length from the local median is a glitch. */
  spikeFraction: number;
  /** Half-width of the glitch check window, seconds. */
  spikeHalfWindowS: number;
  /** When at least this share of the core landmarks of a frame are glitches, the whole frame is dropped. */
  frameJumpShare: number;
  /**
   * Bridge a gap in the athlete's own frame: a joint that was not seen keeps its place in the body while the body moves and turns
   * (see `bodyFrames`). False: every joint is bridged on its own, along a parabola in the picture, as before.
   */
  rigidBridge: boolean;
}

export const DEFAULT_STABILIZE_OPTIONS: StabilizeOptions = {
  minVisibility: 0.4,
  smoothS: 0.15,
  maxGapS: 0.3,
  spikeFraction: 0.2,
  spikeHalfWindowS: 0.07,
  frameJumpShare: 0.4,
  rigidBridge: true,
};

export interface StabilizeStats {
  /** Landmark samples by state, all frames and 33 landmarks together. */
  measured: number;
  interpolated: number;
  corrected: number;
  missing: number;
  /** Landmark samples rejected as glitches (before they were bridged). */
  spikesRejected: number;
  /** Frames where most of the skeleton jumped and the whole frame was dropped. */
  jumpFrames: number;
}

export interface StabilizedPose {
  /** Smoothed landmarks in pixels; visibility holds the per-joint score. Null when nothing is known. */
  landmarks: (Keypoint[] | null)[];
  /** Per landmark, per sample: JOINT_STATE code. */
  state: Uint8Array[];
  /** Per landmark, per sample: confidence 0..1. Measured: the model's visibility. Filled: half the lower score of the two measured neighbours. Missing: 0. */
  score: Float64Array[];
  /** Per sample: mean model visibility of the core landmarks (0 when nobody was detected). */
  confidence: Float64Array;
  /** Median skeleton length in pixels (the yardstick for the glitch threshold and the scale). NaN if unknown. */
  bodyLengthPx: number;
  stats: StabilizeStats;
}

const nanSeries = (n: number) => new Float64Array(n).fill(NaN);

/**
 * Turns raw per-frame landmarks into a clean, gap-free (where possible) time series.
 *
 *  1. Low-confidence landmarks are dropped (treated as missing, not trusted).
 *  2. Glitches are removed: a landmark far from the median of its own neighbours in time is rejected.
 *     If most of a frame's core landmarks are glitches the whole frame is dropped ("skeleton jump").
 *  3. Short gaps are bridged; long gaps stay missing. A joint is bridged in the athlete's own frame (the trunk): it keeps its place
 *     in the body while the body moves and turns. Bridged in the picture, joint by joint, a body that turns during the gap is
 *     squeezed toward its middle (every joint cuts the corner of its arc), and one that turns more than half a turn is turned back.
 *  4. Each landmark path is smoothed with a confidence-weighted local quadratic fit (Savitzky–Golay
 *     style), so a doubtful sample pulls less than a sure one and the fit uses neighbouring frames
 *     instead of treating each frame on its own.
 *
 * Every step is simple and deterministic; nothing is learned.
 */
export function stabilizePose(track: PoseTrack, options: Partial<StabilizeOptions> = {}): StabilizedPose {
  const o = { ...DEFAULT_STABILIZE_OPTIONS, ...options };
  const n = track.frames.length;
  const fps = track.fps;
  const maxGap = Math.max(1, Math.round(o.maxGapS * fps));
  const half = Math.max(2, Math.round(o.spikeHalfWindowS * fps));
  const window = oddWindow(o.smoothS, fps);

  // 1. Raw series, gated by visibility.
  const rawX: Float64Array[] = [];
  const rawY: Float64Array[] = [];
  const rawVis: Float64Array[] = [];
  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const x = nanSeries(n);
    const y = nanSeries(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const kp = track.frames[i]?.[k];
      if (!kp) continue;
      v[i] = kp.visibility;
      if (kp.visibility >= o.minVisibility && Number.isFinite(kp.x) && Number.isFinite(kp.y)) {
        x[i] = kp.x;
        y[i] = kp.y;
      }
    }
    rawX.push(x);
    rawY.push(y);
    rawVis.push(v);
  }

  // Body length from the gated raw data: the yardstick for "how far is too far".
  const lengths = nanSeries(n);
  for (let i = 0; i < n; i++) {
    const pts = rawX.map((xs, k) => ({ x: xs[i], y: rawY[k][i] }));
    lengths[i] = skeletonLength(pts);
  }
  const bodyLengthPx = median(lengths);
  const threshold = (Number.isFinite(bodyLengthPx) ? bodyLengthPx : track.height * 0.5) * o.spikeFraction;

  // 2. Glitch rejection per landmark, then per frame.
  const spikes = rawX.map((xs, k) => spikeMask(xs, rawY[k], half, threshold));
  const jumpFrame = new Uint8Array(n);
  let jumpFrames = 0;
  for (let i = 0; i < n; i++) {
    let seen = 0;
    let bad = 0;
    for (const k of CORE_LANDMARKS) {
      if (!Number.isFinite(rawX[k][i])) continue;
      seen++;
      if (spikes[k][i]) bad++;
    }
    if (seen >= 4 && bad / seen >= o.frameJumpShare) {
      jumpFrame[i] = 1;
      jumpFrames++;
    }
  }

  const state = Array.from({ length: LANDMARK_COUNT }, () => new Uint8Array(n));
  const score = Array.from({ length: LANDMARK_COUNT }, () => new Float64Array(n));
  const smoothX: Float64Array[] = [];
  const smoothY: Float64Array[] = [];
  const stats: StabilizeStats = {
    measured: 0,
    interpolated: 0,
    corrected: 0,
    missing: 0,
    spikesRejected: 0,
    jumpFrames,
  };

  // The landmarks without their glitches.
  const cleanX: Float64Array[] = [];
  const cleanY: Float64Array[] = [];
  const wasRejected: Uint8Array[] = [];
  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const x = Float64Array.from(rawX[k]);
    const y = Float64Array.from(rawY[k]);
    const rejected = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if ((spikes[k][i] || jumpFrame[i]) && Number.isFinite(x[i])) {
        rejected[i] = 1;
        x[i] = NaN;
        y[i] = NaN;
        stats.spikesRejected++;
      }
    }
    cleanX.push(x);
    cleanY.push(y);
    wasRejected.push(rejected);
  }
  const frames = o.rigidBridge ? bodyFrames(cleanX, cleanY, maxGap, 0.1 * threshold) : null;

  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const x = cleanX[k];
    const y = cleanY[k];
    const rejected = wasRejected[k];

    // 3. Bridge short gaps and label every sample.
    const fx = fillGaps(x, maxGap, 'quadratic');
    const fy = fillGaps(y, maxGap, 'quadratic');
    if (frames) fillInBody(x, y, fx, fy, frames, maxGap);
    const w = new Float64Array(n);
    let i = 0;
    while (i < n) {
      if (Number.isFinite(x[i])) {
        state[k][i] = JOINT_STATE.measured;
        score[k][i] = rawVis[k][i];
        w[i] = Math.max(rawVis[k][i], 0.1);
        i++;
        continue;
      }
      let j = i;
      let hadSpike = false;
      while (j < n && !Number.isFinite(x[j])) {
        if (rejected[j]) hadSpike = true;
        j++;
      }
      const bridged = Number.isFinite(fx[i]);
      const before = i > 0 ? score[k][i - 1] : 0;
      const after = j < n ? rawVis[k][j] : 0;
      for (let m = i; m < j; m++) {
        if (bridged) {
          state[k][m] = hadSpike ? JOINT_STATE.corrected : JOINT_STATE.interpolated;
          score[k][m] = 0.5 * Math.min(before, after);
          w[m] = 0.3;
        } else {
          state[k][m] = JOINT_STATE.missing;
        }
      }
      i = j;
    }
    for (let m = 0; m < n; m++) {
      const s = state[k][m];
      if (s === JOINT_STATE.measured) stats.measured++;
      else if (s === JOINT_STATE.interpolated) stats.interpolated++;
      else if (s === JOINT_STATE.corrected) stats.corrected++;
      else stats.missing++;
    }

    // 4. Confidence-weighted temporal smoothing.
    smoothX.push(localPolyFit(fx, window, 2, w).value);
    smoothY.push(localPolyFit(fy, window, 2, w).value);
  }

  const landmarks: (Keypoint[] | null)[] = [];
  const confidence = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let any = false;
    const pts: Keypoint[] = [];
    for (let k = 0; k < LANDMARK_COUNT; k++) {
      const finite = Number.isFinite(smoothX[k][i]) && Number.isFinite(smoothY[k][i]);
      if (finite) any = true;
      pts.push({ x: smoothX[k][i], y: smoothY[k][i], visibility: finite ? score[k][i] : 0 });
    }
    landmarks.push(any ? pts : null);
    confidence[i] = track.frames[i] ? CORE_LANDMARKS.reduce((s, k) => s + rawVis[k][i], 0) / CORE_LANDMARKS.length : 0;
  }
  return { landmarks, state, score, confidence, bodyLengthPx, stats };
}

/** The athlete's own frame in each sample: its origin (the middle of the hips, pixels) and its turn (the hips-to-shoulders direction, radians). NaN where unknown. */
interface BodyFrames {
  cx: Float64Array;
  cy: Float64Array;
  angle: Float64Array;
}

const TRUNK = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP] as const;
/** Frames on each side of a gap that tell how fast the body turns there. */
const RATE_STEPS = 5;

/** The step between two trunk directions whatever the model did with head and feet (the same for a reading and its flipped one), radians. */
function foldedStep(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d > Math.PI / 2 ? d - Math.PI : d < -Math.PI / 2 ? d + Math.PI : d;
}

/**
 * The trunk of every sample as a frame of reference. Where the four trunk joints were seen it is read from them. Across a gap of
 * at most `maxGap` samples it is bridged: the origin along a parabola (the hips of a body in the air), the turn at the rate the
 * body turned before and after the gap, so a body that turned more than half a turn while nobody saw it is not turned back. The
 * trunk direction is taken as it is read on both sides: when the model put the head where the feet are on one side only, the
 * bridge ends half a turn from that side, on the turn the other side was heading for.
 */
function bodyFrames(x: Float64Array[], y: Float64Array[], maxGap: number, minTrunkPx: number): BodyFrames {
  const n = x[0].length;
  const cx = new Float64Array(n).fill(NaN);
  const cy = new Float64Array(n).fill(NaN);
  const angle = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!TRUNK.every((k) => Number.isFinite(x[k][i]))) continue;
    const hx = (x[LM.L_HIP][i] + x[LM.R_HIP][i]) / 2;
    const hy = (y[LM.L_HIP][i] + y[LM.R_HIP][i]) / 2;
    const dx = (x[LM.L_SHOULDER][i] + x[LM.R_SHOULDER][i]) / 2 - hx;
    const dy = (y[LM.L_SHOULDER][i] + y[LM.R_SHOULDER][i]) / 2 - hy;
    // A trunk seen end-on has no direction worth the name.
    if (!(Math.hypot(dx, dy) > minTrunkPx)) continue;
    cx[i] = hx;
    cy[i] = hy;
    angle[i] = Math.atan2(dy, dx);
  }
  const seen = (i: number) => Number.isFinite(angle[i]);
  const rate = (from: number, dir: 1 | -1): number | null => {
    const steps: number[] = [];
    for (let i = from; steps.length < RATE_STEPS && i + dir >= 0 && i + dir < n && seen(i + dir); i += dir)
      steps.push(dir * foldedStep(angle[i], angle[i + dir]));
    return steps.length ? median(steps) : null;
  };
  const bridgedX = fillGaps(cx, maxGap, 'quadratic');
  const bridgedY = fillGaps(cy, maxGap, 'quadratic');
  const out = Float64Array.from(angle);
  let i = 0;
  while (i < n) {
    if (seen(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !seen(j)) j++;
    if (i > 0 && j < n && j - i <= maxGap) {
      const a = i - 1;
      const span = j - a;
      const before = rate(a, -1);
      const after = rate(j, 1);
      const perFrame = before !== null && after !== null ? (before + after) / 2 : (before ?? after ?? 0);
      const predicted = angle[a] + perFrame * span;
      // The far side as it is read, or half a turn from it, on the turn nearest to where the body was heading.
      const end = angle[j] + Math.PI * Math.round((predicted - angle[j]) / Math.PI);
      for (let g = i; g < j; g++) out[g] = angle[a] + ((end - angle[a]) * (g - a)) / span;
    }
    i = j;
  }
  return { cx: bridgedX, cy: bridgedY, angle: out };
}

/**
 * Fills the short gaps of one landmark in the body's frame, over what the plain fill gave (`fx`, `fy`, which stay where the frame is
 * not known): the joint goes from its place in the body before the gap to its place after it, and is put back in the picture with
 * the body's position and turn of each sample.
 */
function fillInBody(
  x: Float64Array,
  y: Float64Array,
  fx: Float64Array,
  fy: Float64Array,
  frames: BodyFrames,
  maxGap: number,
): void {
  const n = x.length;
  const known = (i: number) => Number.isFinite(frames.angle[i]) && Number.isFinite(frames.cx[i]);
  const inBody = (i: number) => {
    const cos = Math.cos(frames.angle[i]);
    const sin = Math.sin(frames.angle[i]);
    const dx = x[i] - frames.cx[i];
    const dy = y[i] - frames.cy[i];
    return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
  };
  let i = 0;
  while (i < n) {
    if (Number.isFinite(x[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !Number.isFinite(x[j])) j++;
    const a = i - 1;
    let ok = i > 0 && j < n && j - i <= maxGap && known(a) && known(j);
    for (let g = i; ok && g < j; g++) ok = known(g);
    if (ok) {
      const from = inBody(a);
      const to = inBody(j);
      for (let g = i; g < j; g++) {
        const f = (g - a) / (j - a);
        const u = from.u + (to.u - from.u) * f;
        const v = from.v + (to.v - from.v) * f;
        const cos = Math.cos(frames.angle[g]);
        const sin = Math.sin(frames.angle[g]);
        fx[g] = frames.cx[g] + u * cos - v * sin;
        fy[g] = frames.cy[g] + u * sin + v * cos;
      }
    }
    i = j;
  }
}
