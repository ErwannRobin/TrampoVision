/** Layout math for the stage: where the video sits in its viewport, and how the viewport is shared in the split view. */

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  x: number;
  y: number;
}

/** A video whose size is not known yet is laid out as 16:9. */
export const DEFAULT_RATIO = 16 / 9;

const validRatio = (ratio: number) => (Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_RATIO);

const NOTHING: Box = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The largest box with the video's aspect ratio (width / height) that fits inside `outer`, centered, in whole pixels.
 * Never distorts and never crops: what is left over is the letterbox.
 */
export function fitRatio(ratio: number, outer: Size): Box {
  const r = validRatio(ratio);
  const w = Math.max(0, Math.floor(outer.width));
  const h = Math.max(0, Math.floor(outer.height));
  if (w === 0 || h === 0) return NOTHING;
  const limitedByHeight = w / h > r;
  const width = limitedByHeight ? Math.min(w, Math.round(h * r)) : w;
  const height = limitedByHeight ? h : Math.min(h, Math.round(w / r));
  return { x: Math.round((outer.width - width) / 2), y: Math.round((outer.height - height) / 2), width, height };
}

export interface SplitLayout {
  /** `row`: the video on the left and the pane on the right. `column`: the video on top and the pane below. */
  direction: 'row' | 'column';
  video: Box;
  pane: Box;
}

/** The most of the shared axis the video may take, so the pane always keeps a usable part of the viewport. */
const VIDEO_SHARE = 0.6;

/**
 * Shares the viewport between the video and a pane: side by side when the viewport is wide, stacked when it is tall.
 * The video keeps its ratio and takes what it needs (up to its share); the pane gets everything else.
 */
export function splitLayout(outer: Size, ratio: number, gap: number): SplitLayout {
  const r = validRatio(ratio);
  const width = Math.max(0, Math.floor(outer.width));
  const height = Math.max(0, Math.floor(outer.height));
  const space = Math.max(0, gap);
  if (width === 0 || height === 0) {
    return { direction: width >= height ? 'row' : 'column', video: NOTHING, pane: NOTHING };
  }

  if (width >= height) {
    const cell = Math.min(height * r, Math.max(0, width - space) * VIDEO_SHARE);
    const video = fitRatio(r, { width: cell, height });
    const x = video.width + space;
    return { direction: 'row', video, pane: { x, y: 0, width: Math.max(0, width - x), height } };
  }

  const cell = Math.min(width / r, Math.max(0, height - space) * VIDEO_SHARE);
  const video = fitRatio(r, { width, height: cell });
  const y = video.height + space;
  return { direction: 'column', video, pane: { x: 0, y, width, height: Math.max(0, height - y) } };
}
