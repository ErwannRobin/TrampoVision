import { JUMP_PHASES } from '../../analysis/jumpCycles';
import { niceTicks } from './geometry';

/** Geometry of the center-of-mass path plot: where each sample lands on the canvas, and which way it is moving. */

export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const PATH_MARGIN = { left: 40, right: 12, top: 12, bottom: 24 };

/** Bounds of the path in meters, widened to the bed and the bed surface when the bed is known. Null: nothing to draw. */
export function trajectoryExtent(
  x: ArrayLike<number>,
  height: ArrayLike<number>,
  count: number,
  bedHalf: number,
): Extent | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(height[i])) continue;
    x0 = Math.min(x0, x[i]);
    x1 = Math.max(x1, x[i]);
    y0 = Math.min(y0, height[i]);
    y1 = Math.max(y1, height[i]);
  }
  if (!Number.isFinite(x0)) return null;
  if (Number.isFinite(bedHalf)) {
    x0 = Math.min(x0, -bedHalf);
    x1 = Math.max(x1, bedHalf);
    y0 = Math.min(y0, 0);
  }
  return { x0, x1, y0, y1 };
}

export interface TrajectoryLayout {
  /** Pixels per meter: the same on both axes, so the path keeps its shape. */
  scale: number;
  X: (meters: number) => number;
  Y: (meters: number) => number;
  box: { x0: number; x1: number; y0: number; y1: number };
  xTicks: number[];
  yTicks: number[];
}

/** Fits the extent into the canvas with equal scales, centered, showing at least 1 m each way. */
export function layoutTrajectory(extent: Extent, width: number, height: number): TrajectoryLayout {
  const m = PATH_MARGIN;
  const box = { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom };
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const rx = Math.max(extent.x1 - extent.x0, 1);
  const ry = Math.max(extent.y1 - extent.y0, 1);
  const scale = Math.max(1e-6, Math.min(bw / rx, bh / ry));
  const cx = (extent.x0 + extent.x1) / 2;
  const cy = (extent.y0 + extent.y1) / 2;
  const X = (v: number) => box.x0 + bw / 2 + (v - cx) * scale;
  const Y = (v: number) => box.y0 + bh / 2 - (v - cy) * scale;
  // The grid covers the whole box, also where the data does not reach.
  const top = cy + bh / 2 / scale;
  const bottom = cy - bh / 2 / scale;
  const left = cx - bw / 2 / scale;
  const right = cx + bw / 2 / scale;
  return {
    scale,
    X,
    Y,
    box,
    xTicks: niceTicks(left, right, Math.max(3, Math.floor(width / 90))),
    yTicks: niceTicks(bottom, top, 4),
  };
}

/** Pixel position of every sample; NaN where the sample has no position. */
export function pathPixels(layout: TrajectoryLayout, x: ArrayLike<number>, height: ArrayLike<number>, count: number) {
  const xs = new Float64Array(count).fill(NaN);
  const ys = new Float64Array(count).fill(NaN);
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(height[i])) continue;
    xs[i] = layout.X(x[i]);
    ys[i] = layout.Y(height[i]);
  }
  return { xs, ys };
}

export const RISING = 1;
export const FALLING = -1;
/** On the bed, or not known: drawn quiet, like the stretches between flights on the timeline. */
export const QUIET = 0;

/** Which way the athlete is moving at each sample, from the analysis' own phases: ascent rises, descent falls. */
export function pathDirections(phase: ArrayLike<number>, vy: ArrayLike<number>, count: number): Int8Array {
  const out = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    switch (JUMP_PHASES[phase[i]]) {
      case 'takeoff':
      case 'ascent':
        out[i] = RISING;
        break;
      case 'landing':
      case 'descent':
        out[i] = FALLING;
        break;
      case 'apex':
        out[i] = vy[i] < 0 ? FALLING : RISING;
        break;
      default:
        out[i] = QUIET;
    }
  }
  return out;
}

/** The sample whose position is nearest to a point, within `radius` pixels; -1 when none is that close. */
export function nearestSample(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  x: number,
  y: number,
  radius: number,
): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < count; i++) {
    const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2; // NaN compares false: a missing sample is never chosen
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
