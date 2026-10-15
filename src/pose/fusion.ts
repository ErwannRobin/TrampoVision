import { LM } from './landmarks';
import type { Keypoint, WorldPoint } from './types';

/**
 * Two pose models' readings of the same athlete, merged into one track. The first one (MediaPipe) is read on every frame and gives
 * the 3D landmarks the twist needs; the second (RTMPose) is read only where the first was doubtful (see quality.ts), and reads an
 * athlete upside down or tucked more often the right way up. Measured on the exports of the sample clips: where both found the athlete
 * their joints sit 0.06 to 0.07 torso lengths apart (median), so where they agree the mean of the two is kept; where one put the head
 * where the feet are, they are a torso length or more apart and one of them has to be chosen.
 *
 * The choice is a path search over the frames (the same idea as orientation.ts): every frame offers up to two readings, and the path
 * with the most plausible bodies (confident joints, the athlete's own proportions) and the smallest change of shape between two frames
 * wins. A head/feet flip changes the shape by two torso lengths in one frame, a double somersault by about a third of one, so a flipped
 * reading costs much more than it can gain. Pure functions: no model, no video.
 */

/** Where a frame of the merged track comes from. */
export const FUSED_FROM = { none: 0, first: 1, second: 2, both: 3 } as const;
export type FusedFrom = (typeof FUSED_FROM)[keyof typeof FUSED_FROM];

/**
 * The scores of the two models do not mean the same: MediaPipe's visibility is near 0 or 1 (half of the joints of the sample
 * exports read above 0.99, and an occluded far-side joint reads below 0.2), RTMPose's are packed between 0.45 and 0.9 (p05 to p90).
 * Each is put on one scale before they are compared or mixed: RTMPose's 0.6 (a little below its median) counts as sure, 0.36 as
 * the 0.4 below which the analysis drops a joint (about 2% of its joints).
 */
export interface ScoreScale {
  /** Raw score that counts as 0. */
  zero: number;
  /** Raw score that counts as 1. */
  one: number;
}
export const MEDIAPIPE_SCALE: ScoreScale = { zero: 0, one: 1 };
export const RTMPOSE_SCALE: ScoreScale = { zero: 0.2, one: 0.6 };

export const onScale = (score: number, scale: ScoreScale): number =>
  Math.min(1, Math.max(0, (score - scale.zero) / (scale.one - scale.zero)));

export interface FusionOptions {
  /** Joints below this (on the common scale) are not trusted, as in the analysis. */
  minVisibility: number;
  /** Two readings agree when the median distance of their joints is below this many torso lengths: they are then averaged. */
  agreeTorso: number;
  /** How much a frame's doubt counts: 1 − the mean score of its core joints. */
  confidenceWeight: number;
  /** How much a body whose proportions are not the athlete's counts (0 for the athlete's own, 1 for a limb off by 60% or more). */
  shapeWeight: number;
  /** How much the change of shape between two frames counts, per (torso length per frame)². */
  motionWeight: number;
  /** Two readings this many frames apart or less are still linked by the motion cost (short gaps). */
  maxLinkFrames: number;
  /** Price of picking the second model's reading alone: a small preference for the reading that also has 3D landmarks. */
  secondPrice: number;
  /** Price of leaving a frame's readings out of the path (the analysis bridges it): more than a doubtful reading, less than a flip. */
  dropPrice: number;
  /** A step between two frames never costs more than this: a path that has to make it might as well start again. */
  breakPrice: number;
}

export const DEFAULT_FUSION_OPTIONS: FusionOptions = {
  minVisibility: 0.4,
  agreeTorso: 0.2,
  confidenceWeight: 1,
  shapeWeight: 1,
  motionWeight: 2,
  maxLinkFrames: 4,
  secondPrice: 0.05,
  dropPrice: 1,
  breakPrice: 6,
};

/** Joints that tell the shape of the body: the ones both models give (COCO 17 without the eyes and ears), hips first. */
const SHAPE_JOINTS = [
  LM.L_HIP,
  LM.R_HIP,
  LM.L_SHOULDER,
  LM.R_SHOULDER,
  LM.NOSE,
  LM.L_ELBOW,
  LM.R_ELBOW,
  LM.L_WRIST,
  LM.R_WRIST,
  LM.L_KNEE,
  LM.R_KNEE,
  LM.L_ANKLE,
  LM.R_ANKLE,
];

/** Bones whose length, relative to the others, is the athlete's own: upper arm, forearm, thigh, shin, and the two sides of the trunk. */
const BONES: [number, number][] = [
  [LM.L_SHOULDER, LM.L_ELBOW],
  [LM.R_SHOULDER, LM.R_ELBOW],
  [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_HIP, LM.L_KNEE],
  [LM.R_HIP, LM.R_KNEE],
  [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_SHOULDER, LM.L_HIP],
  [LM.R_SHOULDER, LM.R_HIP],
];
/** A bone 60% longer or shorter than the athlete's (once the size of the frame is taken out) is as wrong as it gets. */
const SHAPE_SPAN = Math.log(1.6);

export interface FusionInput {
  /** The first model's readings, 33 landmarks in pixels, with its 3D landmarks. */
  first: (Keypoint[] | null)[];
  firstWorld?: (WorldPoint[] | null)[];
  /** The second model's readings (33 landmarks, the ones it lacks unseen); null where it found nobody or was not asked. */
  second: (Keypoint[] | null)[];
  /** Frames where the second model was asked. Elsewhere the first reading is kept as it is. */
  checked: ArrayLike<number>;
  /** The landmarks the second model gives (the others come from the first one, or stay unseen). */
  secondJoints: readonly number[];
  firstScale?: ScoreScale;
  secondScale?: ScoreScale;
}

export interface FusedTrack {
  frames: (Keypoint[] | null)[];
  world: (WorldPoint[] | null)[];
  from: Uint8Array;
  /**
   * Checked frames by outcome: both readings averaged, the first kept, the second taken (alone, or over a first that was there),
   * readings left out of the path (`dropPrice`), and nothing at all.
   */
  counts: {
    checked: number;
    both: number;
    first: number;
    second: number;
    replaced: number;
    dropped: number;
    none: number;
  };
}

interface Reading {
  pose: Keypoint[];
  world: WorldPoint[] | null;
  from: FusedFrom;
  cost: number;
}

const usable = (p: Keypoint | undefined, min: number): boolean =>
  !!p && p.visibility >= min && Number.isFinite(p.x) && Number.isFinite(p.y);

function hipCenter(pose: Keypoint[]): { x: number; y: number } | null {
  const l = pose[LM.L_HIP];
  const r = pose[LM.R_HIP];
  if (!l || !r || !Number.isFinite(l.x) || !Number.isFinite(r.x)) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}

function torso(pose: Keypoint[]): number {
  const h = hipCenter(pose);
  const ls = pose[LM.L_SHOULDER];
  const rs = pose[LM.R_SHOULDER];
  if (!h || !ls || !rs) return NaN;
  return Math.hypot((ls.x + rs.x) / 2 - h.x, (ls.y + rs.y) / 2 - h.y);
}

const rescale = (pose: Keypoint[], scale: ScoreScale): Keypoint[] =>
  pose.map((p) => ({ x: p.x, y: p.y, visibility: onScale(p.visibility, scale) }));

function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Median distance of the joints both readings trust, in torso lengths; NaN when too few are shared. */
export function poseGap(a: Keypoint[], b: Keypoint[], torsoPx: number, min: number): number {
  const d: number[] = [];
  for (const k of SHAPE_JOINTS) {
    if (usable(a[k], min) && usable(b[k], min)) d.push(Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y) / torsoPx);
  }
  return d.length >= 4 ? median(d) : NaN;
}

/** The mean of two readings that agree: the joints both trust weighted by their scores, the others from whichever trusts them. */
function blend(a: Keypoint[], b: Keypoint[], bJoints: ReadonlySet<number>, min: number): Keypoint[] {
  return a.map((p, k) => {
    const q = b[k];
    if (!bJoints.has(k) || !q) return p;
    const pa = usable(p, min);
    const qa = usable(q, min);
    if (pa && qa) {
      const w = p.visibility + q.visibility;
      return {
        x: (p.x * p.visibility + q.x * q.visibility) / w,
        y: (p.y * p.visibility + q.y * q.visibility) / w,
        visibility: Math.max(p.visibility, q.visibility),
      };
    }
    if (qa || (!pa && q.visibility > p.visibility)) return q;
    return p;
  });
}

/** The second reading alone: the landmarks it does not give stay unseen (they would come from a reading that was not chosen). */
function secondAlone(b: Keypoint[], bJoints: ReadonlySet<number>): Keypoint[] {
  return b.map((q, k) => (bJoints.has(k) ? q : { x: 0, y: 0, visibility: 0 }));
}

/** Per bone, the athlete's typical length relative to the size of the frame: what `shapeDoubt` compares a reading with. */
function boneReference(poses: Keypoint[][], min: number): number[] {
  const lengths = BONES.map(() => [] as number[]);
  for (const pose of poses) {
    const t = torso(pose);
    if (!(t > 0)) continue;
    BONES.forEach(([a, b], i) => {
      if (usable(pose[a], min) && usable(pose[b], min))
        lengths[i].push(Math.hypot(pose[a].x - pose[b].x, pose[a].y - pose[b].y) / t);
    });
  }
  return lengths.map(median);
}

/** 0 when the bones of a reading have the athlete's proportions, up to 1 when they are far off (a limb on another person, a collapsed trunk). */
export function shapeDoubt(pose: Keypoint[], reference: readonly number[], min: number): number {
  const ratios: number[] = [];
  BONES.forEach(([a, b], i) => {
    if (!(reference[i] > 0) || !usable(pose[a], min) || !usable(pose[b], min)) return;
    ratios.push(Math.hypot(pose[a].x - pose[b].x, pose[a].y - pose[b].y) / reference[i]);
  });
  if (ratios.length < 4) return 0.5;
  // The size of the frame (the athlete nearer or farther, a zoom) is the median ratio; what is left is the shape.
  const size = median(ratios);
  const off = ratios.map((r) => Math.min(1, Math.abs(Math.log(r / size)) / SHAPE_SPAN));
  return off.reduce((s, v) => s + v, 0) / off.length;
}

function meanCore(pose: Keypoint[]): number {
  let s = 0;
  for (const k of SHAPE_JOINTS) s += pose[k]?.visibility ?? 0;
  return s / SHAPE_JOINTS.length;
}

/** Change of shape between two readings, torso lengths per frame: the joints around the hips, plus the hips' own move. */
function motion(a: Keypoint[], b: Keypoint[], torsoPx: number, frames: number, min: number): number {
  const ha = hipCenter(a);
  const hb = hipCenter(b);
  if (!ha || !hb) return 0;
  let sum = Math.hypot(hb.x - ha.x, hb.y - ha.y) / torsoPx;
  let n = 1;
  for (const k of SHAPE_JOINTS) {
    if (k === LM.L_HIP || k === LM.R_HIP || !usable(a[k], min) || !usable(b[k], min)) continue;
    const dx = b[k].x - hb.x - (a[k].x - ha.x);
    const dy = b[k].y - hb.y - (a[k].y - ha.y);
    sum += Math.min(3, Math.hypot(dx, dy) / torsoPx);
    n++;
  }
  return sum / n / frames;
}

/** Rolling median of the torso length over ±`half` frames, from every reading there is: the yardstick of the costs. */
function torsoScale(first: (Keypoint[] | null)[], second: (Keypoint[] | null)[], half: number): Float64Array {
  const n = first.length;
  const per = Array.from({ length: n }, (_, i) =>
    [first[i], second[i]].flatMap((p) => (p ? [torso(p)] : [])).filter((t) => t > 0),
  );
  const all = median(per.flat());
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const near: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) near.push(...per[j]);
    out[i] = near.length ? median(near) : all;
  }
  return out;
}

/**
 * Merges the second model's readings into the first model's track. Frames that were not checked keep the first reading untouched;
 * a checked frame gets the mean of both when they agree, else the reading the path search prefers, else whichever is there.
 * The 3D landmarks are kept where the first reading is (alone or in the mean): where the second one was taken over it, the first one
 * was wrong, and so were its 3D landmarks.
 */
export function fusePoseTracks(input: FusionInput, options: Partial<FusionOptions> = {}): FusedTrack {
  const o = { ...DEFAULT_FUSION_OPTIONS, ...options };
  const n = input.first.length;
  const firstScale = input.firstScale ?? MEDIAPIPE_SCALE;
  const secondScale = input.secondScale ?? RTMPOSE_SCALE;
  const bJoints = new Set(input.secondJoints);
  const first = input.first.map((p) => (p ? rescale(p, firstScale) : null));
  const second = input.second.map((p, i) =>
    p && input.checked[i] ? secondAlone(rescale(p, secondScale), bJoints) : null,
  );
  const scale = torsoScale(first, second, 15);
  const reference = boneReference(
    [...first, ...second].filter((p): p is Keypoint[] => p !== null),
    o.minVisibility,
  );

  const unary = (pose: Keypoint[]) =>
    o.confidenceWeight * (1 - meanCore(pose)) + o.shapeWeight * shapeDoubt(pose, reference, o.minVisibility);

  // The readings of every frame. An unchecked frame offers the first reading only, so the path is anchored on it.
  const options_: Reading[][] = Array.from({ length: n }, (_, i) => {
    const a = first[i];
    const b = second[i];
    const world = input.firstWorld?.[i] ?? null;
    if (a && b) {
      const gap = poseGap(a, b, scale[i], o.minVisibility);
      if (gap <= o.agreeTorso) {
        const pose = blend(a, b, bJoints, o.minVisibility);
        return [{ pose, world, from: FUSED_FROM.both, cost: unary(pose) }];
      }
      return [
        { pose: a, world, from: FUSED_FROM.first, cost: unary(a) },
        { pose: b, world: null, from: FUSED_FROM.second, cost: unary(b) + o.secondPrice },
      ];
    }
    if (a) return [{ pose: a, world, from: FUSED_FROM.first, cost: unary(a) }];
    if (b) return [{ pose: b, world: null, from: FUSED_FROM.second, cost: unary(b) + o.secondPrice }];
    return [];
  });

  // The cheapest path through the readings. A step links a reading to one of the frames before it within `maxLinkFrames`, so a
  // frame's readings can be left out (at `dropPrice` each: a frame whose only reading is turned over is better dropped, and
  // bridged by the analysis, than followed); farther apart, nothing links them. A step never costs more than `breakPrice`: past
  // it the path might as well start again. Index n is the end of the path.
  const read: number[] = [];
  for (let i = 0; i < n; i++) if (options_[i].length) read.push(i);
  const total: number[][] = options_.map((r) => r.map(() => Infinity));
  const back: [number, number][][] = options_.map((r) => r.map((): [number, number] => [-1, -1]));
  let endBack: [number, number] = [-1, -1];
  for (let ri = 0; ri <= read.length; ri++) {
    const i = ri < read.length ? read[ri] : n;
    const here = i < n ? options_[i] : [null];
    here.forEach((r, c) => {
      const cost = r ? r.cost : 0;
      let best = ri === 0 ? cost : Infinity;
      let from: [number, number] = [-1, -1];
      // The frames before: those within reach, or the last one when none is (a gap with no reading at all costs nothing).
      for (let pj = ri - 1, dropped = 0; pj >= 0; pj--, dropped++) {
        const j = read[pj];
        if (i - j > o.maxLinkFrames && pj < ri - 1) break;
        const near = i - j <= o.maxLinkFrames;
        options_[j].forEach((q, p) => {
          let link = 0;
          if (r && near) {
            const step = motion(q.pose, r.pose, scale[i], i - j, o.minVisibility);
            link = Math.min(o.breakPrice, o.motionWeight * step * step);
          }
          const t = total[j][p] + cost + link + o.dropPrice * dropped;
          if (t < best) {
            best = t;
            from = [j, p];
          }
        });
      }
      if (r) {
        total[i][c] = best;
        back[i][c] = from;
      } else {
        endBack = from;
      }
    });
  }

  const chosen = new Int8Array(n).fill(-1);
  for (let [j, c] = endBack; j >= 0; [j, c] = back[j][c]) chosen[j] = c;

  const frames: (Keypoint[] | null)[] = [];
  const world: (WorldPoint[] | null)[] = [];
  const from = new Uint8Array(n);
  const counts = { checked: 0, both: 0, first: 0, second: 0, replaced: 0, dropped: 0, none: 0 };
  for (let f = 0; f < n; f++) {
    if (!input.checked[f]) {
      frames.push(input.first[f]);
      world.push(input.firstWorld?.[f] ?? null);
      from[f] = input.first[f] ? FUSED_FROM.first : FUSED_FROM.none;
      continue;
    }
    counts.checked++;
    const r = chosen[f] >= 0 ? options_[f][chosen[f]] : null;
    frames.push(r ? r.pose : null);
    world.push(r ? r.world : null);
    from[f] = r ? r.from : FUSED_FROM.none;
    if (!r) counts[options_[f].length ? 'dropped' : 'none']++;
    else if (r.from === FUSED_FROM.both) counts.both++;
    else if (r.from === FUSED_FROM.first) counts.first++;
    else {
      counts.second++;
      if (first[f]) counts.replaced++;
    }
  }
  return { frames, world, from, counts };
}
