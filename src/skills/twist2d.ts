import type { JumpCycle } from '../analysis/jumpCycles';
import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';

/**
 * Twist from the 2D skeleton alone: a second way to count half twists when there is no reliable 3D estimate.
 *
 * Seen from the side, the shoulder line of a body that twists by an angle phi about its own long axis, projected on the axis
 * perpendicular to the trunk in the image, is  W * sin(phi0 + phi(t))  (W = shoulder width, phi0 = where the athlete started
 * relative to the camera). Whatever the camera yaw, a horizontal circle projected on a line has the same amplitude, so the yaw
 * only moves phi0. The same holds for the hip line. Three cues come out of it:
 *
 *   width        |shoulder line| and |hip line| oscillate: one minimum per half twist. Robust to left/right label swaps.
 *   chirality    the signed line (left minus right shoulder, on the trunk's perpendicular) changes sign at each half twist, and
 *                its sign tells the phase. A left/right label swap of the pose model flips it, so it is only used when
 *   face         the visibility of nose and eyes (high when the face looks toward the camera, which is in phase with the signed
 *                line) agrees with it, and the nose offset from the ears (in quadrature) is a second check of the phase.
 *
 * The count is a model fit, not an unwrapped angle: for every number of half twists (0..8) and a small family of twist profiles
 * (when it starts and ends inside the flight) the model curve is fitted to the measured curves, and the number with the smallest
 * residual wins. The confidence is the product of explicit checks (fit quality, margin to the next count, width vs chirality
 * agreement, frames per half twist, coverage, plausible amplitude, face agreement). It is internal consistency, NOT a
 * probability of being right.
 *
 * What it cannot do: tell the direction of the twist, or the timing of the twist inside the flight (the profile is part of the
 * fit, not a measurement). It assumes the shoulder width in trunk lengths is about the prior below (a +-25% error is tolerated).
 * It has been checked on a simulated athlete only; there is no real twisting ground truth yet.
 */

export interface Twist2dConfig {
  /** Landmarks below this model visibility are treated as missing. */
  minVisibility: number;
  /** Flights with fewer usable frames are not read. */
  minFrames: number;
  /** Largest number of half twists tried. */
  maxHalfTwists: number;
  /** Shoulder width / hip width in trunk lengths for an upright body (the amplitude of the width curves). A prior, not a measurement. */
  shoulderRatio: number;
  hipRatio: number;
  /** The fitted amplitude may differ from the prior by this factor (below / above). */
  amplitudeMin: number;
  amplitudeMax: number;
  /** Residual (in units of the prior amplitude) at which the fit quality reaches 0. */
  rmseMax: number;
  /** Frames per half twist at which the rate check is fully passed / failed (the width curve needs a few samples per half twist). */
  framesPerHalfTwistOk: number;
  framesPerHalfTwistMin: number;
  /** Share of the flight that must have a usable skeleton for full marks, and the least that is read at all. */
  coverageOk: number;
  coverageMin: number;
  /** Share of frames where the side of the signed shoulder line matches the side of the face at which the chirality is trusted / distrusted. */
  faceAgreeOk: number;
  faceAgreeMin: number;
  /** Confidence from which the count is shown as a measurement. */
  minConfidence: number;
}

export const DEFAULT_TWIST2D_CONFIG: Twist2dConfig = {
  minVisibility: 0.3,
  minFrames: 8,
  maxHalfTwists: 8,
  shoulderRatio: 0.76,
  hipRatio: 0.4,
  amplitudeMin: 0.6,
  amplitudeMax: 1.5,
  rmseMax: 0.4,
  framesPerHalfTwistOk: 5,
  framesPerHalfTwistMin: 2.5,
  coverageOk: 0.8,
  coverageMin: 0.4,
  faceAgreeOk: 0.97,
  faceAgreeMin: 0.85,
  minConfidence: 0.5,
};

export type FaceCheck = 'consistent' | 'inconsistent' | 'unavailable';

export interface Twist2dEstimate {
  /** The flight had enough usable frames to read. */
  available: boolean;
  /** Number of half twists, whatever their direction (the direction cannot be told from one side view). */
  halfTwists: number | null;
  /** Twists (a full twist = 2 half twists). */
  twists: number | null;
  /** halfTwists x 180. Unsigned. */
  totalDeg: number | null;
  /** Product of the parts, 0..1: internal consistency, NOT a probability of being right. */
  confidence: number;
  /** confidence >= the configured minimum. */
  reliable: boolean;
  parts: {
    fit: number;
    margin: number;
    agreement: number;
    rate: number;
    coverage: number;
    amplitude: number;
    face: number;
  };
  /** The count each cue gives alone (null when the cue was not usable). */
  cues: { width: number | null; chirality: number | null; face: FaceCheck };
  /** Frames inside one half twist at this count (null for no twist). */
  framesPerHalfTwist: number | null;
  /** Residual of the best fit, in units of the prior amplitude. */
  rmse: number | null;
}

export interface Twist2dAnalysis {
  config: Twist2dConfig;
  jumps: Twist2dEstimate[];
}

export interface Twist2dInput {
  /** Landmarks in pixels per analyzed frame (the raw track: smoothing would flatten a fast twist), null where nobody was found. */
  frames: (Keypoint[] | null)[];
  time: ArrayLike<number>;
  fps: number;
  cycles: Pick<JumpCycle, 'takeoffTimeS' | 'landingTimeS' | 'complete'>[];
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ramp = (v: number, bad: number, ok: number) => clamp01((v - bad) / (ok - bad));

/** When the twist starts and ends inside the flight (shares of it): the family of profiles the fit chooses from. */
const PROFILES: [number, number][] = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].flatMap((a) =>
  [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1].map((b) => [a, b] as [number, number]),
);
/** Start phases tried: 7.5 degree steps over the whole circle. */
const PHASES = 48;
const MARGIN_EPS = 0.004;

const none = (face: FaceCheck = 'unavailable'): Twist2dEstimate => ({
  available: false,
  halfTwists: null,
  twists: null,
  totalDeg: null,
  confidence: 0,
  reliable: false,
  parts: { fit: 0, margin: 0, agreement: 0, rate: 0, coverage: 0, amplitude: 0, face: 0 },
  cues: { width: null, chirality: null, face },
  framesPerHalfTwist: null,
  rmse: null,
});

interface Sample {
  u: number;
  /** Signed shoulder / hip separation on the trunk's perpendicular, in trunk lengths, divided by the prior width (1 = a full width). */
  s: number;
  h: number;
  /** Nose offset from the ears' midpoint on the same axis, in trunk lengths (NaN if not seen). */
  nose: number;
  /** Face visibility, 0..1 (NaN if the landmarks carry none). */
  face: number;
}

function correlation(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 6) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  // No variation on either side: nothing to correlate (a body that does not twist shows a constant line).
  if (saa < 1e-6 * n || sbb < 1e-6 * n) return null;
  return sab / Math.sqrt(saa * sbb);
}

/** The usable samples of one flight. */
function samples(input: Twist2dInput, t0: number, t1: number, cfg: Twist2dConfig): { list: Sample[]; frames: number } {
  const list: Sample[] = [];
  let frames = 0;
  for (let i = 0; i < input.frames.length; i++) {
    const time = input.time[i];
    if (time < t0 - 1e-9 || time > t1 + 1e-9) continue;
    frames++;
    const kp = input.frames[i];
    if (!kp) continue;
    const ok = (k: number) =>
      kp[k] && kp[k].visibility >= cfg.minVisibility && Number.isFinite(kp[k].x) && Number.isFinite(kp[k].y);
    if (!(ok(LM.L_SHOULDER) && ok(LM.R_SHOULDER) && ok(LM.L_HIP) && ok(LM.R_HIP))) continue;
    const sx = (kp[LM.L_SHOULDER].x + kp[LM.R_SHOULDER].x) / 2;
    const sy = (kp[LM.L_SHOULDER].y + kp[LM.R_SHOULDER].y) / 2;
    const hx = (kp[LM.L_HIP].x + kp[LM.R_HIP].x) / 2;
    const hy = (kp[LM.L_HIP].y + kp[LM.R_HIP].y) / 2;
    const len = Math.hypot(sx - hx, sy - hy);
    if (len < 2) continue;
    const ux = (sx - hx) / len;
    const uy = (sy - hy) / len;
    // The axis perpendicular to the trunk in the image, turned the same way whatever the trunk's angle.
    const px = -uy;
    const py = ux;
    const along = (a: Keypoint, b: Keypoint) => ((a.x - b.x) * px + (a.y - b.y) * py) / len;
    const s = along(kp[LM.L_SHOULDER], kp[LM.R_SHOULDER]) / cfg.shoulderRatio;
    const h = along(kp[LM.L_HIP], kp[LM.R_HIP]) / cfg.hipRatio;
    let nose = NaN;
    if (ok(LM.NOSE) && ok(LM.L_EAR) && ok(LM.R_EAR)) {
      const ex = (kp[LM.L_EAR].x + kp[LM.R_EAR].x) / 2;
      const ey = (kp[LM.L_EAR].y + kp[LM.R_EAR].y) / 2;
      nose = ((kp[LM.NOSE].x - ex) * px + (kp[LM.NOSE].y - ey) * py) / len;
    }
    const face = ([LM.NOSE, LM.L_EYE, LM.R_EYE] as number[]).reduce((sum, k) => sum + (kp[k]?.visibility ?? 0), 0) / 3;
    list.push({ u: (time - t0) / (t1 - t0), s, h, nose, face });
  }
  return { list, frames };
}

interface Best {
  cost: number;
  h: number;
  amp: number;
  phase: number;
  profile: number;
}

/**
 * The number of half twists of one flight from the 2D skeleton. See the module comment for the idea and its limits.
 */
export function estimateTwist2d(
  input: Twist2dInput,
  cycle: Twist2dInput['cycles'][number],
  cfg: Twist2dConfig,
): Twist2dEstimate {
  if (!cycle.complete || cycle.takeoffTimeS === null || cycle.landingTimeS === null) return none();
  const { list, frames } = samples(input, cycle.takeoffTimeS, cycle.landingTimeS, cfg);
  const n = list.length;
  if (n < cfg.minFrames || frames === 0) return none();
  const coverage = n / frames;
  if (coverage < cfg.coverageMin) return none();

  // Width (unsigned) and signed curves; the shoulders count twice as much as the hips (they are wider, so better measured).
  const w = list.map((p) => (2 * Math.abs(p.s) + Math.abs(p.h)) / 3);
  const q = list.map((p) => (2 * p.s + p.h) / 3);
  let sw2 = 0;
  let sq2 = 0;
  for (let k = 0; k < n; k++) {
    sw2 += w[k] * w[k];
    sq2 += q[k] * q[k];
  }

  // Does the face say the same as the signed line? Face visibility is in phase with the line, whatever the start phase: where the
  // line is clearly on one side the face is on one side too. A left/right swap of the pose model flips the line but not the face.
  const withFace = list.filter((p) => Number.isFinite(p.face) && p.face > 0);
  const faceCorr = correlation(
    withFace.map((p) => (2 * p.s + p.h) / 3),
    withFace.map((p) => p.face),
  );
  let signAgree: number | null = null;
  if (withFace.length >= 6 && faceCorr !== null) {
    const faces = withFace.map((p) => p.face);
    const centre = (Math.max(...faces) + Math.min(...faces)) / 2;
    let agree = 0;
    let total = 0;
    for (const p of withFace) {
      const line = (2 * p.s + p.h) / 3;
      if (Math.abs(line) < 0.25) continue;
      total++;
      if (Math.sign(line) === Math.sign(p.face - centre)) agree++;
    }
    // The polarity is arbitrary (which side is "left" depends on the facing), so the better of the two counts.
    if (total >= 5) signAgree = Math.max(agree, total - agree) / total;
  }
  const face: FaceCheck =
    faceCorr === null || signAgree === null
      ? 'unavailable'
      : signAgree >= cfg.faceAgreeMin
        ? 'consistent'
        : 'inconsistent';
  // Trusted chirality weighs fully, an unchecked one half, one that contradicts the face (the labels are probably swapped) not at all.
  const lambda = face === 'unavailable' ? 0.5 : ramp(signAgree ?? 0, cfg.faceAgreeMin, cfg.faceAgreeOk);

  const bestW: Best[] = [];
  const bestS: Best[] = [];
  const bestJ: Best[] = [];
  const m = new Float64Array(n);
  const sinT = new Float64Array(n);
  const cosT = new Float64Array(n);
  const clampAmp = (a: number) => Math.min(Math.max(a, cfg.amplitudeMin), cfg.amplitudeMax);
  for (let h = 0; h <= cfg.maxHalfTwists; h++) {
    const bw: Best = { cost: Infinity, h, amp: 1, phase: 0, profile: 0 };
    const bs: Best = { cost: Infinity, h, amp: 1, phase: 0, profile: 0 };
    const bj: Best = { cost: Infinity, h, amp: 1, phase: 0, profile: 0 };
    for (let pi = 0; pi < PROFILES.length; pi++) {
      const [a, b] = PROFILES[pi];
      for (let k = 0; k < n; k++) {
        const theta = Math.PI * h * smoothstep(a, b, list[k].u);
        sinT[k] = Math.sin(theta);
        cosT[k] = Math.cos(theta);
      }
      for (let ip = 0; ip < PHASES; ip++) {
        const phi0 = (ip * 2 * Math.PI) / PHASES;
        const sp = Math.sin(phi0);
        const cp = Math.cos(phi0);
        let smm = 0;
        let swm = 0;
        let sqm = 0;
        for (let k = 0; k < n; k++) {
          const v = sp * cosT[k] + cp * sinT[k];
          m[k] = v;
          smm += v * v;
          swm += w[k] * Math.abs(v);
          sqm += q[k] * v;
        }
        const cost = (aa: number, sxy: number, sxx: number, syy: number) => (syy - 2 * aa * sxy + aa * aa * sxx) / n;
        const aW = clampAmp(smm > 1e-9 ? swm / smm : cfg.amplitudeMax);
        const cW = cost(aW, swm, smm, sw2);
        const aS = clampAmp(smm > 1e-9 ? sqm / smm : cfg.amplitudeMax);
        const cS = cost(aS, sqm, smm, sq2);
        const aJ = clampAmp(smm > 1e-9 ? (swm + lambda * sqm) / (smm * (1 + lambda)) : cfg.amplitudeMax);
        const cJ = (cost(aJ, swm, smm, sw2) + lambda * cost(aJ, sqm, smm, sq2)) / (1 + lambda);
        if (cW < bw.cost) Object.assign(bw, { cost: cW, amp: aW, phase: phi0, profile: pi });
        if (cS < bs.cost) Object.assign(bs, { cost: cS, amp: aS, phase: phi0, profile: pi });
        if (cJ < bj.cost) Object.assign(bj, { cost: cJ, amp: aJ, phase: phi0, profile: pi });
      }
    }
    bestW.push(bw);
    bestS.push(bs);
    bestJ.push(bj);
  }
  const argmin = (list2: Best[]) => list2.reduce((a, b) => (b.cost < a.cost ? b : a));
  const hw = argmin(bestW);
  const hs = argmin(bestS);
  const hj = argmin(bestJ);
  const chosen = lambda > 0 ? hj : hw;
  const half = chosen.h;
  const second = bestJ.filter((b) => b.h !== half).reduce((a, b) => (b.cost < a.cost ? b : a));
  const reference = lambda > 0 ? chosen.cost : hw.cost;
  const secondCost =
    lambda > 0 ? second.cost : bestW.filter((b) => b.h !== half).reduce((a, b) => (b.cost < a.cost ? b : a)).cost;

  const rmse = Math.sqrt(Math.max(reference, 0));
  const fit = clamp01(1 - (rmse / cfg.rmseMax) ** 2);
  const margin = clamp01(((secondCost + MARGIN_EPS) / (reference + MARGIN_EPS) - 1) / 1.5);
  // Width and chirality read alone: the same count is the best evidence; a neighbour is a weak one; the signed line is only
  // compared when it can be trusted at all.
  const chiralityUsable = lambda > 0;
  const agreement = !chiralityUsable ? 0.7 : hw.h === hs.h ? 1 : Math.abs(hw.h - hs.h) === 1 ? 0.5 : 0.25;
  const framesPerHalfTwist = half > 0 ? (frames * 0.7) / half : null;
  const rate =
    framesPerHalfTwist === null ? 1 : ramp(framesPerHalfTwist, cfg.framesPerHalfTwistMin, cfg.framesPerHalfTwistOk);
  const coverageScore = ramp(coverage, cfg.coverageMin, cfg.coverageOk);
  const amplitude =
    half === 0
      ? 1
      : (() => {
          const lo = cfg.amplitudeMin;
          const hi = cfg.amplitudeMax;
          const a = chosen.amp;
          // Full marks within 0.75..1.3 of the prior, falling to nothing at the ends of the allowed range.
          return a < 0.75 ? ramp(a, lo, 0.75) : a > 1.3 ? 1 - ramp(a, 1.3, hi) : 1;
        })();

  // The nose is in quadrature with the shoulder line: at the best fit it should follow cos(phi0 + theta).
  let faceScore = face === 'unavailable' ? 0.85 : face === 'consistent' ? 1 : 0.8;
  const [pa, pb] = PROFILES[chosen.profile];
  const noseSamples = list.filter((p) => Number.isFinite(p.nose));
  if (half > 0 && noseSamples.length >= 8 && face !== 'inconsistent') {
    const pred = noseSamples.map((p) => Math.cos(chosen.phase + Math.PI * half * smoothstep(pa, pb, p.u)));
    const r = correlation(
      pred,
      noseSamples.map((p) => p.nose),
    );
    if (r !== null) faceScore *= Math.abs(r) >= 0.5 ? 1 : Math.abs(r) >= 0.25 ? 0.85 : 0.7;
  }

  const parts = { fit, margin, agreement, rate, coverage: coverageScore, amplitude, face: faceScore };
  const confidence = clamp01(fit * margin * agreement * rate * coverageScore * amplitude * faceScore);
  return {
    available: true,
    halfTwists: half,
    twists: half / 2,
    totalDeg: half * 180,
    confidence,
    reliable: confidence >= cfg.minConfidence,
    parts,
    cues: { width: hw.h, chirality: chiralityUsable ? hs.h : null, face: face },
    framesPerHalfTwist,
    rmse,
  };
}

/** The 2D twist of every jump of a clip. */
export function analyzeTwist2d(input: Twist2dInput, config?: Partial<Twist2dConfig>): Twist2dAnalysis {
  const cfg = { ...DEFAULT_TWIST2D_CONFIG, ...config };
  return { config: cfg, jumps: input.cycles.map((c) => estimateTwist2d(input, c, cfg)) };
}
