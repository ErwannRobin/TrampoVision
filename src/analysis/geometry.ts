import { LM } from '../pose/landmarks';
import type { Point } from '../pose/types';

const RAD2DEG = 180 / Math.PI;

export function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at `b` between segments b→a and b→c, in degrees [0, 180]. 180 = straight. */
export function jointAngle(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.abs(Math.atan2(cross, dot)) * RAD2DEG;
}

/**
 * Orientation of the vector `from → to` relative to vertical-up in the image plane, in degrees
 * (-180, 180]. 0 = pointing up, +90 = pointing right, ±180 = pointing down (inverted).
 * Positive = clockwise as seen in the video. Image y points down, hence the sign flip.
 */
export function angleFromVertical(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, -(to.y - from.y)) * RAD2DEG;
}

/** Length of the nose → shoulders → hips → knees → ankles path (about 0.9 x standing height). NaN if a point is missing. */
export function skeletonLength(pts: Point[]): number {
  const shoulders = mid(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
  const hips = mid(pts[LM.L_HIP], pts[LM.R_HIP]);
  const knees = mid(pts[LM.L_KNEE], pts[LM.R_KNEE]);
  const ankles = mid(pts[LM.L_ANKLE], pts[LM.R_ANKLE]);
  return dist(pts[LM.NOSE], shoulders) + dist(shoulders, hips) + dist(hips, knees) + dist(knees, ankles);
}
