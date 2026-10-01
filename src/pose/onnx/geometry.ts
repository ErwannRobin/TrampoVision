/** Boxes and the crop that feeds a top-down pose model. Pure functions: no canvas, no model. */

/** A box in image pixels. */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

/** The part of the image a pose model sees: a rectangle of the model's aspect ratio around a person. */
export interface Crop {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** What top-down models (RTMPose, ViTPose) are trained with: the person's box, 25 % larger, widened to the input's shape. */
export const CROP_PADDING = 1.25;

export function cropAround(box: Box, aspect: number, padding = CROP_PADDING): Crop {
  const bw = (box.x2 - box.x1) * padding;
  const bh = (box.y2 - box.y1) * padding;
  const wide = bw > bh * aspect;
  return {
    cx: (box.x1 + box.x2) / 2,
    cy: (box.y1 + box.y2) / 2,
    w: wide ? bw : bh * aspect,
    h: wide ? bw / aspect : bh,
  };
}

/** A point of the model's input (pixels of the crop as fed to the model) back to the image. */
export function cropToImage(
  crop: Crop,
  inputW: number,
  inputH: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: crop.cx - crop.w / 2 + (x / inputW) * crop.w,
    y: crop.cy - crop.h / 2 + (y / inputH) * crop.h,
  };
}

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return inter / union;
}

/** Highest scores first; a box that overlaps a better one by more than `maxIou` is dropped. */
export function nms(boxes: Box[], maxIou: number): Box[] {
  const kept: Box[] = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k, box) <= maxIou)) kept.push(box);
  }
  return kept;
}
