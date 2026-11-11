import { median, unwrapDegrees, wrapDegrees } from './signal';

/**
 * Body orientation that survives a pose model turning the athlete upside down.
 *
 * The trunk angle (hips to shoulders) of each frame is the model's word. When the athlete is inverted, tucked and blurred, the model sometimes
 * puts the head where the feet are for a few frames: the trunk angle is then 180° off. `unwrapDegrees` cannot tell that from a real rotation, so
 * the net rotation, and with it the somersault count, goes wrong. A real body cannot turn half a revolution between two frames (a double
 * somersault turns about 15° per frame), so the repair is a path search: every frame has three readings, as measured, 180° away ("flipped"),
 * and not read at all ("rejected": the angle has nothing to do with the body, and the frame is left to its neighbors), and the path with the
 * smoothest angular velocity wins, with a price for each switch between the first two and for each frame left out. Two independent witnesses
 * (the ankles to head line, and the center of mass to head direction) lean on the choice a little; they are only a tie-breaker, because when
 * the model flips the whole body they flip with it.
 *
 * Across a gap (frames with no angle, or whose angle is not to be used) the body kept turning: the turn expected over the gap is the mean of
 * the rate before it and the rate after it, so a body that sped up or slowed down while nobody saw it is still put on the right turn.
 *
 * On a clean track nothing is flipped or rejected and the result is the same as `unwrapDegrees`.
 */

export interface OrientationOptions {
  /** Price of switching between the measured and the flipped reading, in units of one squared tolerance. */
  flipPenalty: number;
  /** Price of leaving a frame's reading out. A little more than one switch: two flipped frames in a row are a flip, not two rejections. */
  rejectPenalty: number;
  /** A frame that was left out is taken back when its reading, or the flipped one, is this close to where the path went, degrees. */
  takeBackDeg: number;
  /** Change of the per-frame rotation step that costs 1, degrees per frame. */
  accelSigmaDeg: number;
  /** Disagreement with a witness that costs 1 (saturating), degrees. */
  witnessSigmaDeg: number;
  /** How much the two witnesses count next to the physics (1 = as much as a deviation of one tolerance per frame). */
  witnessWeight: number;
  /** A frame whose weight is low lets its angle deviate at a lower price: its trunk was seen badly. */
  minWeight: number;
  /**
   * A body in the air cannot turn back: nothing can take its angular momentum away. Once it turns faster than `turningDeg` a frame,
   * a move of more than `backFreeDeg` against the turn (the trunk does swing that much against it when the body folds or opens)
   * costs 1 for every `backSigmaDeg` beyond it, squared. Only where the reading may be overruled (`allowFlip`), so not on the bed.
   */
  turningDeg: number;
  backFreeDeg: number;
  backSigmaDeg: number;
}

export const DEFAULT_ORIENTATION_OPTIONS: OrientationOptions = {
  flipPenalty: 8,
  rejectPenalty: 9,
  takeBackDeg: 24,
  accelSigmaDeg: 12,
  witnessSigmaDeg: 60,
  witnessWeight: 0.3,
  minWeight: 0.4,
  turningDeg: 4,
  backFreeDeg: 40,
  backSigmaDeg: 12,
};

export interface OrientationInput {
  /** Wrapped trunk angle per frame, degrees, NaN where unknown. */
  angle: ArrayLike<number>;
  /**
   * Frames whose angle was made up (a joint bridged across a gap or a glitch): the joints of a bridged frame move on their own, so the angle
   * they give is a collapsed trunk, not the athlete's. They do not take part in the search, and their orientation is interpolated from
   * the frames around them.
   */
  ignore?: ArrayLike<number>;
  /**
   * Frames where the reading may be turned over (the athlete is in the air). On the bed the body is not turning freely, and a trunk that
   * is bent double is not a head/feet flip. Default: everywhere.
   */
  allowFlip?: ArrayLike<number>;
  /** 0..1 how much each frame's angle can be trusted (trunk visible, not collapsed). Default 1. */
  weight?: ArrayLike<number>;
  /** Wrapped angle of a second direction that should agree with the trunk (ankles to head), and its weight 0..1. */
  line?: ArrayLike<number>;
  lineWeight?: ArrayLike<number>;
  /** Same for the direction from the center of mass to the head. */
  head?: ArrayLike<number>;
  headWeight?: ArrayLike<number>;
}

export interface OrientationTrack {
  /** Continuous orientation, degrees (the angle of each frame put on the 360° branch the rotation was heading for). */
  orientation: Float64Array;
  /** 1 where the frame was read 180° away from what the model said. */
  flipped: Uint8Array;
  /** 1 where the frame's angle was left out: it fits neither as measured nor flipped. Its orientation is that of the frames around it. */
  rejected: Uint8Array;
  /** Frames read flipped, and how many separate stretches of them there were. */
  flippedFrames: number;
  flipRuns: number;
  rejectedFrames: number;
}

/** Same as `unwrapDegrees`, for callers that do not repair anything. */
export function plainOrientation(angle: ArrayLike<number>): OrientationTrack {
  return {
    orientation: unwrapDegrees(angle),
    flipped: new Uint8Array(angle.length),
    rejected: new Uint8Array(angle.length),
    flippedFrames: 0,
    flipRuns: 0,
    rejectedFrames: 0,
  };
}

/** Largest per-frame rotation trusted when predicting the next frame (matches `unwrapDegrees`). */
const MAX_PREDICTED_RATE = 150;

/** Steps after a gap that tell how fast the body turns there. */
const RATE_AFTER_STEPS = 5;

interface Node {
  cost: number;
  out: number;
  /** Recent per-frame steps (newest last) of the path that ends here. */
  steps: number[];
  /** Index (into the valid frames) of the previous node's state, -1 at the start. */
  prevState: number;
  /** Frames since the last reading the path used (0 when this frame's is used). */
  since: number;
}

const angularDistance = (a: number, b: number) => Math.abs(wrapDegrees(a - b));
const clampRate = (r: number) => Math.min(Math.max(r, -MAX_PREDICTED_RATE), MAX_PREDICTED_RATE);
/** A step between two frames whatever the model did with head and feet: the same for a reading and for its flipped one. */
const foldedStep = (from: number, to: number) => {
  const d = wrapDegrees(to - from);
  return d > 90 ? d - 180 : d < -90 ? d + 180 : d;
};

/** The four states of a frame: its reading used as measured (0) or flipped (1), or left out while the path is unflipped (2) or flipped (3). */
const STATES = [0, 1, 2, 3] as const;
const flipOf = (s: number) => s & 1;
const leftOut = (s: number) => s >= 2;

export function trackOrientation(input: OrientationInput, options: Partial<OrientationOptions> = {}): OrientationTrack {
  const o = { ...DEFAULT_ORIENTATION_OPTIONS, ...options };
  const n = input.angle.length;
  const orientation = new Float64Array(n).fill(NaN);
  const flipped = new Uint8Array(n);
  const rejected = new Uint8Array(n);
  const valid: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(input.angle[i]) && !input.ignore?.[i]) valid.push(i);
  if (!valid.length) return { orientation, flipped, rejected, flippedFrames: 0, flipRuns: 0, rejectedFrames: 0 };

  /** How much frame i dislikes reading `deg` (witnesses). Saturates, so a witness cannot outvote the physics. */
  const witnessCost = (i: number, deg: number): number => {
    let c = 0;
    for (const [w, ww] of [
      [input.line, input.lineWeight],
      [input.head, input.headWeight],
    ] as const) {
      const v = w?.[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const weight = ww ? Math.min(1, Math.max(0, ww[i])) : 1;
      if (!(weight > 0)) continue;
      c += o.witnessWeight * weight * Math.min(1, (angularDistance(deg, v) / o.witnessSigmaDeg) ** 2);
    }
    return c;
  };
  const weightOf = (i: number) =>
    input.weight ? Math.min(1, Math.max(o.minWeight, Number.isFinite(input.weight[i]) ? input.weight[i] : 1)) : 1;

  // How fast the body turns in the frames that follow each one (null when the next frame is not the next of the clip): what a gap
  // that ends here is bridged with, together with the rate before it.
  const rateAfter = valid.map((_, k) => {
    const steps: number[] = [];
    for (let j = k; j + 1 < valid.length && steps.length < RATE_AFTER_STEPS && valid[j + 1] === valid[j] + 1; j++)
      steps.push(foldedStep(input.angle[valid[j]], input.angle[valid[j + 1]]));
    return steps.length ? clampRate(median(steps)) : null;
  });

  const layers: Node[][] = [];
  for (let k = 0; k < valid.length; k++) {
    const i = valid[k];
    const m = input.angle[i];
    const free = input.allowFlip === undefined || !!input.allowFlip[i];
    const here: Node[] = [];
    for (const s of STATES) {
      const v = m + 180 * flipOf(s);
      // On the bed the reading is taken as it is: neither flipped nor left out.
      if (s !== 0 && !free) {
        here.push({ cost: Infinity, out: v, steps: [], prevState: 0, since: 0 });
        continue;
      }
      if (k === 0) {
        // Nothing before: the clip is taken as read, and starting flipped has a price.
        const cost = (flipOf(s) ? o.flipPenalty : 0) + (leftOut(s) ? o.rejectPenalty : witnessCost(i, v));
        here.push({ cost, out: v, steps: [], prevState: -1, since: leftOut(s) ? 1 : 0 });
        continue;
      }
      const elapsed = i - valid[k - 1];
      let best: Node | null = null;
      for (const p of STATES) {
        const prev = layers[k - 1][p];
        if (!Number.isFinite(prev.cost)) continue;
        // A frame left out changes nothing: the path stays as flipped as it was.
        if (leftOut(s) && flipOf(p) !== flipOf(s)) continue;
        // The rate the path came at; a path that has none yet (the start of the clip, the first frames after a gap) takes it from the
        // frames that follow, so that a body already turning fast is not charged for its first step.
        const before = prev.steps.length ? clampRate(median(prev.steps)) : elapsed === 1 ? rateAfter[k - 1] : null;
        const after = elapsed > 1 ? rateAfter[k] : null;
        const rate = before !== null && after !== null ? (before + after) / 2 : (before ?? after ?? 0);
        const predicted = prev.out + rate * elapsed;
        const span = elapsed + prev.since;
        const switched = flipOf(p) !== flipOf(s) ? o.flipPenalty : 0;
        let node: Node;
        if (leftOut(s)) {
          node = { cost: prev.cost + o.rejectPenalty, out: predicted, steps: prev.steps, prevState: p, since: span };
        } else {
          const out = v + 360 * Math.round((predicted - v) / 360);
          const dev = (out - predicted) / (o.accelSigmaDeg * span);
          // Turning back in the air: the move since the last frame goes against the turn the path came at.
          let back = 0;
          if (free && before !== null && Math.abs(before) >= o.turningDeg) {
            const against = -(out - prev.out) * Math.sign(before) - o.backFreeDeg;
            if (against > 0) back = (against / o.backSigmaDeg) ** 2;
          }
          const cost = prev.cost + weightOf(i) * dev * dev + back + switched + witnessCost(i, v);
          const steps = elapsed === 1 && !leftOut(p) ? [...prev.steps, out - prev.out].slice(-3) : prev.steps;
          node = { cost, out, steps, prevState: p, since: 0 };
        }
        if (!best || node.cost < best.cost) best = node;
      }
      here.push(best ?? { cost: Infinity, out: v, steps: [], prevState: 0, since: 0 });
    }
    layers.push(here);
  }

  const last = layers[layers.length - 1];
  let state = 0;
  for (const s of STATES) if (last[s].cost < last[state].cost) state = s;
  const states = new Uint8Array(valid.length);
  for (let k = valid.length - 1; k >= 0; k--) {
    const node = layers[k][state];
    states[k] = state;
    if (!leftOut(state)) {
      orientation[valid[k]] = node.out;
      flipped[valid[k]] = flipOf(state);
    }
    state = node.prevState;
  }

  // The frames left out get the orientation of the frames around them. One whose reading turns out to sit on that path after all, as
  // measured or flipped, is taken back: it was only not allowed to steer the path (a single flipped frame is cheaper to leave out than
  // to switch for, and it is still a flipped frame).
  const skipped = new Uint8Array(n);
  for (let k = 0; k < valid.length; k++) if (leftOut(states[k])) skipped[valid[k]] = 1;
  fillBetween(orientation, skipped);
  for (let k = 0; k < valid.length; k++) {
    if (!leftOut(states[k])) continue;
    const i = valid[k];
    const path = orientation[i];
    let taken = false;
    if (Number.isFinite(path)) {
      for (const f of [0, 1] as const) {
        const v = input.angle[i] + 180 * f;
        const out = v + 360 * Math.round((path - v) / 360);
        if (Math.abs(out - path) > o.takeBackDeg) continue;
        orientation[i] = out;
        flipped[i] = f;
        taken = true;
        break;
      }
    }
    if (!taken) rejected[i] = 1;
  }

  if (input.ignore) {
    const ignored = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (input.ignore[i] && Number.isFinite(input.angle[i])) ignored[i] = 1;
    fillBetween(orientation, ignored);
  }

  let flippedFrames = 0;
  let flipRuns = 0;
  let rejectedFrames = 0;
  let inRun = false;
  for (const i of valid) {
    if (rejected[i]) rejectedFrames++;
    if (flipped[i]) {
      flippedFrames++;
      if (!inRun) flipRuns++;
      inRun = true;
    } else inRun = false;
  }
  return { orientation, flipped, rejected, flippedFrames, flipRuns, rejectedFrames };
}

/** The frames marked in `which` get the orientation interpolated between their neighbors (the end ones hold the nearest value). */
function fillBetween(orientation: Float64Array, which: ArrayLike<number>): void {
  const n = orientation.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(orientation[i])) {
      prev = i;
      continue;
    }
    if (!which[i]) continue;
    let next = i + 1;
    while (next < n && !Number.isFinite(orientation[next])) next++;
    if (prev >= 0 && next < n)
      orientation[i] = orientation[prev] + ((orientation[next] - orientation[prev]) * (i - prev)) / (next - prev);
    else if (prev >= 0) orientation[i] = orientation[prev];
    else if (next < n) orientation[i] = orientation[next];
  }
}
