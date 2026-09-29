import { LM } from './landmarks';
import type { Keypoint, Point } from './types';

function hipCenter(kp: Keypoint[]): Point {
  return { x: (kp[LM.L_HIP].x + kp[LM.R_HIP].x) / 2, y: (kp[LM.L_HIP].y + kp[LM.R_HIP].y) / 2 };
}

function boxArea(kp: Keypoint[]): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of kp) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return (x1 - x0) * (y1 - y0);
}

/**
 * Picks the athlete among the people detected in a frame (pixel coordinates).
 * First frame: the biggest person. Later frames: the person closest to where the athlete
 * was in the previous frame (temporal continuity), so coaches/judges walking by are ignored.
 */
export function selectAthlete(candidates: Keypoint[][], previous: Keypoint[] | null): Keypoint[] | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!previous) {
    return candidates.reduce((best, c) => (boxArea(c) > boxArea(best) ? c : best));
  }
  const ref = hipCenter(previous);
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const h = hipCenter(c);
    const d = Math.hypot(h.x - ref.x, h.y - ref.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
