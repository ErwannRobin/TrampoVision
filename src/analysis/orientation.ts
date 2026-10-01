import { median, unwrapDegrees, wrapDegrees } from './signal';

/**
 * Body orientation that survives a pose model turning the athlete upside down.
 *
 * The trunk angle (hips to shoulders) of each frame is the model's word. When the athlete is inverted, tucked and blurred, the model sometimes
 * puts the head where the feet are for a few frames: the trunk angle is then 180° off. `unwrapDegrees` cannot tell that from a real rotation, so
 * the net rotation, and with it the somersault count, goes wrong. A real body cannot turn half a revolution between two frames (a double
 * somersault turns about 15° per frame), so the repair is a path search: every frame has two readings, as measured and 180° away ("flipped"),
 * and the path with the smoothest angular velocity wins, with a price for each switch between the two. Two independent witnesses (the ankles
 * to head line, and the center of mass to head direction) lean on the choice a little; they are only a tie-breaker, because when the model flips
 * the whole body they flip with it.
 *
 * On a clean track nothing is flipped and the result is the same as `unwrapDegrees`.
 */

export interface OrientationOptions {
  /** Price of switching between the measured and the flipped reading, in units of one squared tolerance. */
  flipPenalty: number;
  /** Change of the per-frame rotation step that costs 1, degrees per frame. */
  accelSigmaDeg: number;
  /** Disagreement with a witness that costs 1 (saturating), degrees. */
  witnessSigmaDeg: number;
  /** How much the two witnesses count next to the physics (1 = as much as a deviation of one tolerance per frame). */
  witnessWeight: number;
  /** A frame whose weight is low lets its angle deviate at a lower price: its trunk was seen badly. */
  minWeight: number;
}

export const DEFAULT_ORIENTATION_OPTIONS: OrientationOptions = {
  flipPenalty: 8,
  accelSigmaDeg: 12,
  witnessSigmaDeg: 60,
  witnessWeight: 0.3,
  minWeight: 0.4,
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
  /** Frames read flipped, and how many separate stretches of them there were. */
  flippedFrames: number;
  flipRuns: number;
}

/** Same as `unwrapDegrees`, for callers that do not repair anything. */
export function plainOrientation(angle: ArrayLike<number>): OrientationTrack {
  return {
    orientation: unwrapDegrees(angle),
    flipped: new Uint8Array(angle.length),
    flippedFrames: 0,
    flipRuns: 0,
  };
}

/** Largest per-frame rotation trusted when predicting the next frame (matches `unwrapDegrees`). */
const MAX_PREDICTED_RATE = 150;

interface Node {
  cost: number;
  out: number;
  /** Recent per-frame steps (newest last) of the path that ends here. */
  steps: number[];
  /** Index (into the valid frames) of the previous node's state, -1 at the start. */
  prevState: number;
}

const angularDistance = (a: number, b: number) => Math.abs(wrapDegrees(a - b));

export function trackOrientation(input: OrientationInput, options: Partial<OrientationOptions> = {}): OrientationTrack {
  const o = { ...DEFAULT_ORIENTATION_OPTIONS, ...options };
  const n = input.angle.length;
  const orientation = new Float64Array(n).fill(NaN);
  const flipped = new Uint8Array(n);
  const valid: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(input.angle[i]) && !input.ignore?.[i]) valid.push(i);
  if (!valid.length) return { orientation, flipped, flippedFrames: 0, flipRuns: 0 };

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

  const layers: [Node, Node][] = [];
  for (let k = 0; k < valid.length; k++) {
    const i = valid[k];
    const m = input.angle[i];
    const here: [Node, Node] = [null as unknown as Node, null as unknown as Node];
    for (const s of [0, 1] as const) {
      const v = m + 180 * s;
      if (k === 0) {
        // Nothing before: the clip is taken as read, and starting flipped has a price.
        here[s] = { cost: (s ? o.flipPenalty : 0) + witnessCost(i, v), out: v, steps: [], prevState: -1 };
        continue;
      }
      const prevIdx = valid[k - 1];
      const elapsed = i - prevIdx;
      let best: Node | null = null;
      for (const p of [0, 1] as const) {
        const prev = layers[k - 1][p];
        const rate = prev.steps.length
          ? Math.min(Math.max(median(prev.steps), -MAX_PREDICTED_RATE), MAX_PREDICTED_RATE)
          : 0;
        const predicted = prev.out + rate * elapsed;
        const out = v + 360 * Math.round((predicted - v) / 360);
        const dev = (out - predicted) / (o.accelSigmaDeg * elapsed);
        const cost = prev.cost + weightOf(i) * dev * dev + (p !== s ? o.flipPenalty : 0) + witnessCost(i, v);
        if (!best || cost < best.cost) {
          const steps = elapsed === 1 ? [...prev.steps, out - prev.out].slice(-3) : prev.steps;
          best = { cost, out, steps, prevState: p };
        }
      }
      here[s] = best!;
    }
    layers.push(here);
  }

  let state = layers[layers.length - 1][0].cost <= layers[layers.length - 1][1].cost ? 0 : 1;
  for (let k = valid.length - 1; k >= 0; k--) {
    const node = layers[k][state];
    orientation[valid[k]] = node.out;
    flipped[valid[k]] = state;
    state = node.prevState;
  }

  fillIgnored(orientation, input);

  let flippedFrames = 0;
  let flipRuns = 0;
  let inRun = false;
  for (const i of valid) {
    if (flipped[i]) {
      flippedFrames++;
      if (!inRun) flipRuns++;
      inRun = true;
    } else inRun = false;
  }
  return { orientation, flipped, flippedFrames, flipRuns };
}

/** Frames that were left out of the search get the orientation interpolated between their neighbors (the end ones hold the nearest value). */
function fillIgnored(orientation: Float64Array, input: OrientationInput): void {
  if (!input.ignore) return;
  const n = orientation.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(orientation[i])) {
      prev = i;
      continue;
    }
    if (!input.ignore[i] || !Number.isFinite(input.angle[i])) continue;
    let next = i + 1;
    while (next < n && !Number.isFinite(orientation[next])) next++;
    if (prev >= 0 && next < n)
      orientation[i] = orientation[prev] + ((orientation[next] - orientation[prev]) * (i - prev)) / (next - prev);
    else if (prev >= 0) orientation[i] = orientation[prev];
    else if (next < n) orientation[i] = orientation[next];
  }
}
