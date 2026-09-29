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

  /** The athlete among the people detected in a frame (pixel coordinates), or null when none of them is the tracked person. */
  select(candidates: Keypoint[][]): Keypoint[] | null {
    if (candidates.length === 0) return this.lose();
    if (!this.last) return this.follow(this.biggest(candidates));

    const size = this.size;
    const predicted = { x: this.last.x + this.velocity.x, y: this.last.y + this.velocity.y };
    const gate = size * (BASE_GATE + GATE_GROWTH * this.missed);

    let best: Keypoint[] | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      const s = torsoLength(c);
      const h = hipCenter(c);
      // Both the predicted position and the last seen one count: the athlete changes direction at the top of a jump.
      const d = Math.min(
        Math.hypot(h.x - predicted.x, h.y - predicted.y),
        Math.hypot(h.x - this.last.x, h.y - this.last.y),
      );
      const ratio = s > 0 && size > 0 ? s / size : 1;
      if (d > gate || ratio > MAX_SIZE_RATIO || ratio < 1 / MAX_SIZE_RATIO) continue;
      const cost = d / size + 2 * Math.abs(Math.log(ratio));
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best ? this.follow(best) : this.lose();
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
