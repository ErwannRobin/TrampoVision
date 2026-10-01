import { LM } from './landmarks';
import type { Keypoint, Point } from './types';

function mid(a: Keypoint, b: Keypoint): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function hipCenter(kp: Keypoint[]): Point {
  return mid(kp[LM.L_HIP], kp[LM.R_HIP]);
}

/** Shoulder-to-hip length in pixels: unchanged by rotating in the image plane, so it follows the athlete through a somersault. */
function torsoLength(kp: Keypoint[]): number {
  const s = mid(kp[LM.L_SHOULDER], kp[LM.R_SHOULDER]);
  const h = hipCenter(kp);
  const torso = Math.hypot(s.x - h.x, s.y - h.y);
  // Degenerate landmarks (all on one point): fall back on the size of the box so the gate never closes completely.
  return torso > 1 ? torso : Math.max(1, Math.sqrt(boxArea(kp)) * 0.35);
}

function boxArea(kp: Keypoint[]): number {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of kp) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return (x1 - x0) * (y1 - y0);
}

/** Someone with this ratio of the athlete's size (either way) is somebody else: a person in the foreground or far behind. */
const MAX_SIZE_RATIO = 2.2;
/** How far the athlete may move between two frames, in torso lengths, before the motion prediction is taken into account. */
const BASE_GATE = 3;
/** The gate opens by this many torso lengths per frame the athlete was not found, so a long loss can still be recovered. */
const GATE_GROWTH = 0.5;
/** How much of the newest size measurement enters the running size of the athlete. */
const SIZE_SMOOTHING = 0.15;

/**
 * Follows one person through the video. The first frame picks the biggest person; from then on the athlete is the
 * detection that continues the track: where the motion predicts them, at their size. Somebody who walks into the
 * foreground, or a camera move that puts another person in front, is not the athlete: if nobody continues the track the
 * frame is left empty rather than jumping to a stranger.
 */
export class AthleteTracker {
  private last: Point | null = null;
  private velocity: Point = { x: 0, y: 0 };
  private size = 0;
  private missed = 0;

  /** True once the tracker has locked on somebody. */
  get started(): boolean {
    return this.last !== null;
  }

  /** The athlete among the people detected in a frame (pixel coordinates), or null when none of them is the tracked person. */
  select(candidates: Keypoint[][]): Keypoint[] | null {
    if (candidates.length === 0) return this.lose();
    if (!this.last) return this.follow(this.biggest(candidates));

    let best: Keypoint[] | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      const cost = this.cost(c);
      if (cost !== null && cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best ? this.follow(best) : this.lose();
  }

  /** How badly a detection continues this track (0 = perfectly), or null when it is outside the gate or the wrong size. */
  cost(c: Keypoint[]): number | null {
    if (!this.last) return null;
    const size = this.size;
    const predicted = { x: this.last.x + this.velocity.x, y: this.last.y + this.velocity.y };
    const gate = size * (BASE_GATE + GATE_GROWTH * this.missed);
    const s = torsoLength(c);
    const h = hipCenter(c);
    // Both the predicted position and the last seen one count: the athlete changes direction at the top of a jump.
    const d = Math.min(
      Math.hypot(h.x - predicted.x, h.y - predicted.y),
      Math.hypot(h.x - this.last.x, h.y - this.last.y),
    );
    const ratio = s > 0 && size > 0 ? s / size : 1;
    if (d > gate || ratio > MAX_SIZE_RATIO || ratio < 1 / MAX_SIZE_RATIO) return null;
    return d / size + 2 * Math.abs(Math.log(ratio));
  }

  /** Continue the track with this detection. */
  accept(kp: Keypoint[]): Keypoint[] {
    return this.follow(kp);
  }

  /** Nobody continued the track in this frame. */
  miss(): void {
    this.lose();
  }

  private biggest(candidates: Keypoint[][]): Keypoint[] {
    return candidates.reduce((best, c) => (boxArea(c) > boxArea(best) ? c : best));
  }

  private follow(kp: Keypoint[]): Keypoint[] {
    const h = hipCenter(kp);
    const s = torsoLength(kp);
    if (this.last) {
      // Velocity per frame; a frame gap means the last position is older, so spread the displacement over it.
      const frames = this.missed + 1;
      this.velocity = { x: (h.x - this.last.x) / frames, y: (h.y - this.last.y) / frames };
    }
    if (s > 0) this.size = this.size > 0 ? this.size + SIZE_SMOOTHING * (s - this.size) : s;
    this.last = h;
    this.missed = 0;
    return kp;
  }

  private lose(): null {
    this.missed++;
    return null;
  }
}

/**
 * Follows several people at once (synchro, or two trampolines side by side). Every athlete has a track of their own, and a
 * detection belongs to one track only: the best matches over all the pairs are settled first, so two athletes who come
 * close or cross are not swapped. The first frame gives the tracks to the biggest people, the leftmost one first.
 */
export class MultiAthleteTracker {
  private readonly trackers: AthleteTracker[];

  constructor(count: number) {
    this.trackers = Array.from({ length: Math.max(1, Math.floor(count)) }, () => new AthleteTracker());
  }

  get count(): number {
    return this.trackers.length;
  }

  /** One entry per athlete, in the same order every frame: the detection that continues their track, or null. */
  select(candidates: Keypoint[][]): (Keypoint[] | null)[] {
    const out: (Keypoint[] | null)[] = this.trackers.map(() => null);
    const taken = new Set<number>();

    // Tracks already locked on somebody: the cheapest pairs first, one detection per track and one track per detection.
    const pairs: { slot: number; index: number; cost: number }[] = [];
    this.trackers.forEach((tr, slot) => {
      candidates.forEach((c, index) => {
        const cost = tr.cost(c);
        if (cost !== null) pairs.push({ slot, index, cost });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    for (const { slot, index } of pairs) {
      if (out[slot] || taken.has(index)) continue;
      out[slot] = this.trackers[slot].accept(candidates[index]);
      taken.add(index);
    }

    // Tracks without anybody yet take the biggest people nobody else claimed; the leftmost person gets the first track.
    const idle = this.trackers.flatMap((tr, slot) => (tr.started ? [] : [slot]));
    if (idle.length) {
      const free = candidates
        .map((c, index) => ({ c, index }))
        .filter(({ index }) => !taken.has(index))
        .sort((a, b) => boxArea(b.c) - boxArea(a.c))
        .slice(0, idle.length)
        .sort((a, b) => hipCenter(a.c).x - hipCenter(b.c).x);
      free.forEach(({ c, index }, i) => {
        out[idle[i]] = this.trackers[idle[i]].accept(c);
        taken.add(index);
      });
    }

    this.trackers.forEach((tr, slot) => {
      if (!out[slot]) tr.miss();
    });
    return out;
  }
}
