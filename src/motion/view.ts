import type { PoseDetection } from '../pose/types';

/**
 * The picture the pose model is given in place of the frame: a part of the frame, made bigger and turned so that the athlete stands upright.
 * It is a similarity (a move, a turn and one scale), so the landmarks the model finds in it go back to the frame exactly.
 *
 *     view point = anchor + scale × turn(-angle) × (frame point - centre)
 *
 * `angle` is how far the athlete leans to the right (clockwise in the picture, as `trunkAngle` reads it): the picture is turned by as much the
 * other way, which puts them upright.
 */
export interface View {
  /** The point of the frame that the view is built around, frame pixels, and where in the view it goes, view pixels. */
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  /** Degrees: how far the athlete leans to the right in the frame, and so how far the frame is turned to the left to make the view. */
  angle: number;
  /** View pixels for one pixel of the frame. */
  scale: number;
  /** The size of the view, pixels. */
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const radians = (deg: number): number => (deg * Math.PI) / 180;

/** `p` turned by `deg` degrees clockwise in the picture (y points down). */
function turned(p: Point, deg: number): Point {
  const c = Math.cos(radians(deg));
  const s = Math.sin(radians(deg));
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Where a point of the frame is in the view. */
export function toView(p: Point, view: View): Point {
  const t = turned({ x: p.x - view.cx, y: p.y - view.cy }, -view.angle);
  return { x: view.ax + view.scale * t.x, y: view.ay + view.scale * t.y };
}

/** Where a point of the view is in the frame: the other way. */
export function fromView(q: Point, view: View): Point {
  const t = turned({ x: (q.x - view.ax) / view.scale, y: (q.y - view.ay) / view.scale }, view.angle);
  return { x: view.cx + t.x, y: view.cy + t.y };
}

/** The view that turns the frame about `center` by `angle` and leaves it as big as it was, with `center` where it was. */
export function turnedView(frame: { width: number; height: number }, center: Point, angle: number): View {
  return {
    cx: center.x,
    cy: center.y,
    ax: center.x,
    ay: center.y,
    angle,
    scale: 1,
    width: frame.width,
    height: frame.height,
  };
}

/** The view of a square of `side` frame pixels around `center`, turned by `angle`, made `size` × `size` pixels. */
export function squareView(center: Point, side: number, angle: number, size: number): View {
  return {
    cx: center.x,
    cy: center.y,
    ax: size / 2,
    ay: size / 2,
    angle,
    scale: size / side,
    width: size,
    height: size,
  };
}

/** True when the view is the frame itself. */
export const isIdentity = (view: View, frame: { width: number; height: number }): boolean =>
  view.angle === 0 &&
  view.scale === 1 &&
  view.cx === view.ax &&
  view.cy === view.ay &&
  view.width === frame.width &&
  view.height === frame.height;

/**
 * The people the pose model found in a view, as they are in the frame: the landmarks (0 to 1 of the view) are taken back to 0 to 1 of the frame,
 * and the 3D landmarks, which are in metres around the hips and aligned with the picture, turned back by the angle (their depth is not changed
 * by a turn of the picture).
 */
export function detectionsInFrame(
  people: PoseDetection[],
  view: View,
  frame: { width: number; height: number },
): PoseDetection[] {
  return people.map((person) => ({
    landmarks: person.landmarks.map((l) => {
      const p = fromView({ x: l.x * view.width, y: l.y * view.height }, view);
      return { x: p.x / frame.width, y: p.y / frame.height, visibility: l.visibility };
    }),
    world: person.world?.map((w) => {
      const t = turned({ x: w.x, y: w.y }, view.angle);
      return { x: t.x, y: t.y, z: w.z, visibility: w.visibility };
    }),
  }));
}

/** Paints the view of `source` on `ctx` (a canvas of the view's size): the part of the frame, turned and scaled, with `fill` where the frame has nothing. */
export function paintView(ctx: CanvasRenderingContext2D, source: CanvasImageSource, view: View, fill: string): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(view.ax, view.ay);
  ctx.scale(view.scale, view.scale);
  ctx.rotate(-radians(view.angle));
  ctx.drawImage(source, -view.cx, -view.cy);
  ctx.restore();
}
