import type { Point } from '../pose/types';
import { t } from '../i18n/core';
import { solveLinearSystem } from './signal';

/** Four bed corners, in order around the bed (either direction, any corner first). */
export type Quad = [Point, Point, Point, Point];

/**
 * Manual trampoline calibration: the four corners of the bed as clicked in the video, plus the real
 * size of the bed. Side 1→2 (and 3→4) is `firstSideM` long, side 2→3 (and 4→1) is `secondSideM` long.
 */
export interface TrampolineCalibration {
  corners: Quad;
  firstSideM: number;
  secondSideM: number;
}

/** Competition bed size (FIG), meters: 4.28 x 2.14. Written from memory: check your own trampoline. */
export const DEFAULT_BED_M = { long: 4.28, short: 2.14 };

export interface NormalizedPosition {
  /** Horizontal offset from the bed center, meters. + = right in the image. */
  xM: number;
  /** xM divided by the half-size of the bed along the same direction: +-1 = the edge of the bed. */
  xNorm: number;
  /** Height above the bed surface, meters. */
  heightM: number;
}

export interface CalibrationModel {
  input: TrampolineCalibration;
  /** Bed center in image pixels (crossing point of the diagonals). */
  center: Point;
  /** Real meters per image pixel on the horizontal, at the bed center's distance from the camera. */
  metersPerPixel: number;
  /**
   * Angle in degrees between the on-screen horizontal (as it lies on the bed) and side 1→2:
   * 0 = the camera sees side 1→2 face-on, 90 = it looks along that side. Only this direction can be
   * measured with one camera.
   */
  viewAngleDeg: number;
  /** Half-size of the bed along the on-screen horizontal, meters. */
  halfExtentM: number;
  /** Image point → bed-plane meters (exact only for points lying ON the bed surface). */
  toBed(p: Point): Point;
  /** Position of an image point (e.g. the center of mass) relative to the bed. */
  normalize(p: Point): NormalizedPosition;
}

export type CalibrationResult = { ok: true; model: CalibrationModel } | { ok: false; error: string };

/** Homography (image px → plane meters) from exactly four point pairs (direct linear transform, h33 = 1). */
function homography(src: Point[], dst: Point[]): number[] | null {
  const A: number[] = [];
  const b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k];
    const { x: X, y: Y } = dst[k];
    A.push(x, y, 1, 0, 0, 0, -X * x, -X * y);
    b.push(X);
    A.push(0, 0, 0, x, y, 1, -Y * x, -Y * y);
    b.push(Y);
  }
  return solveLinearSystem(A, b, 8);
}

function applyH(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + 1;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Intersection of the diagonals c0–c2 and c1–c3. */
function diagonalCrossing(c: Quad): Point | null {
  const [p, q, r, s] = [c[0], c[2], c[1], c[3]];
  const d1 = { x: q.x - p.x, y: q.y - p.y };
  const d2 = { x: s.x - r.x, y: s.y - r.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const along = ((r.x - p.x) * d2.y - (r.y - p.y) * d2.x) / den;
  return { x: p.x + along * d1.x, y: p.y + along * d1.y };
}

/**
 * The reasons a marking is refused, as the analysis keeps them (English, in the data). What a person reads is the same reason in the
 * language in use.
 */
const ERROR_KEYS = {
  'Bed sizes must be positive.': 'calibration.error.sizes',
  'Invalid corner position.': 'calibration.error.corner',
  'The four corners must be in order around the bed (no crossing lines).': 'calibration.error.order',
  'The bed outline is too small: click the corners farther apart.': 'calibration.error.small',
  'Could not compute the calibration from these corners.': 'calibration.error.compute',
} as const;
export const calibrationErrorText = (error: string): string =>
  error in ERROR_KEYS ? t(ERROR_KEYS[error as keyof typeof ERROR_KEYS]) : error;

/**
 * Builds the calibration model.
 *
 * What it assumes (explained, because it decides how far the numbers can be trusted):
 *  - The corners give the image → bed-plane mapping (a homography). It is exact for points ON the bed,
 *    but the athlete is in the air, and the ray through a point high above the bed hits the bed plane
 *    far away or behind the camera. So the athlete is NOT mapped through the homography.
 *  - Instead, the camera is assumed to be level (looking roughly horizontally, no roll) so that vertical
 *    lines stay vertical in the image. The horizontal offset of the athlete from the bed center is the
 *    image x distance to the bed center times the bed's meters-per-pixel at the center, and the height
 *    is the image y distance above the bed center times the same scale.
 *  - Both are exact when the athlete stays in the vertical plane through the bed center that is parallel
 *    to the image plane. Being 10% closer to or farther from the camera changes the scale by about 10%.
 *  - One camera cannot see depth, so only the on-screen horizontal direction is measured.
 */
export function buildCalibration(input: TrampolineCalibration): CalibrationResult {
  const { corners, firstSideM: a, secondSideM: b } = input;
  if (!(a > 0) || !(b > 0)) return { ok: false, error: 'Bed sizes must be positive.' };
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return { ok: false, error: 'Invalid corner position.' };

  const signs = [0, 1, 2, 3].map((i) => Math.sign(cross(corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4])));
  if (!(signs.every((s) => s > 0) || signs.every((s) => s < 0))) {
    return { ok: false, error: 'The four corners must be in order around the bed (no crossing lines).' };
  }
  const area =
    Math.abs(corners.reduce((s, p, i) => s + (p.x * corners[(i + 1) % 4].y - corners[(i + 1) % 4].x * p.y), 0)) / 2;
  if (area < 400) return { ok: false, error: 'The bed outline is too small: click the corners farther apart.' };

  const h = homography(corners, [
    { x: 0, y: 0 },
    { x: a, y: 0 },
    { x: a, y: b },
    { x: 0, y: b },
  ]);
  const center = diagonalCrossing(corners);
  if (!h || !center) return { ok: false, error: 'Could not compute the calibration from these corners.' };
  const toBed = (p: Point) => applyH(h, p);

  // Scale and direction of the on-screen horizontal at the bed center (central difference over 20 px).
  const left = toBed({ x: center.x - 10, y: center.y });
  const right = toBed({ x: center.x + 10, y: center.y });
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const len = Math.hypot(dx, dy);
  const metersPerPixel = len / 20;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return { ok: false, error: 'Could not compute the calibration from these corners.' };
  }
  const ux = Math.abs(dx) / len;
  const uy = Math.abs(dy) / len;
  const halfExtentM = Math.min(a / 2 / Math.max(ux, 1e-9), b / 2 / Math.max(uy, 1e-9));
  const viewAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;

  const model: CalibrationModel = {
    input,
    center,
    metersPerPixel,
    viewAngleDeg,
    halfExtentM,
    toBed,
    normalize: (p) => {
      const xM = (p.x - center.x) * metersPerPixel;
      return { xM, xNorm: xM / halfExtentM, heightM: (center.y - p.y) * metersPerPixel };
    },
  };
  return { ok: true, model };
}
