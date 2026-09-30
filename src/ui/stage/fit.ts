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
/** A pane beside the video is of no use narrower than this (the 3D skeleton needs room to be read). */
const MIN_SIDE_PANE = 220;
/**
 * Stacked only when the viewport is clearly taller than wide. A viewport near square is where a few dozen pixels decide
 * (the browser's toolbars, the home-screen app having none), so it must not flip between the two.
 */
const TALL = 1.25;

/**
 * Shares the viewport between the video and a pane: side by side, unless the viewport is clearly tall or the pane would be
 * too narrow to use beside the video, and then stacked. The video keeps its ratio and takes what it needs (up to its
 * share); the pane gets everything else.
 */
export function splitLayout(outer: Size, ratio: number, gap: number): SplitLayout {
  const r = validRatio(ratio);
  const width = Math.max(0, Math.floor(outer.width));
  const height = Math.max(0, Math.floor(outer.height));
  const space = Math.max(0, gap);
  if (width === 0 || height === 0) {
    return { direction: width >= height ? 'row' : 'column', video: NOTHING, pane: NOTHING };
  }

  if (height <= width * TALL) {
    const cell = Math.min(height * r, Math.max(0, width - space) * VIDEO_SHARE);
    const video = fitRatio(r, { width: cell, height });
    const x = video.width + space;
    if (width - x >= MIN_SIDE_PANE) {
      return { direction: 'row', video, pane: { x, y: 0, width: Math.max(0, width - x), height } };
    }
  }

  const cell = Math.min(width / r, Math.max(0, height - space) * VIDEO_SHARE);
  const video = fitRatio(r, { width, height: cell });
  const y = video.height + space;
  return { direction: 'column', video, pane: { x: 0, y, width, height: Math.max(0, height - y) } };
}

export type Orientation = 'portrait' | 'landscape';

/**
 * Which way a clip is filmed, from the size of its frames as they are shown (a phone's rotation included). Taller than wide is
 * portrait. A square clip, or one whose size is not known (yet), is landscape: the layout the interface starts from.
 */
export function clipOrientation(size: Size | null | undefined): Orientation {
  if (!size || !(size.width > 0) || !(size.height > 0)) return 'landscape';
  return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * The width the stage asks for when the clip is portrait and the page is wide, so that the rail gets the rest: the video at the
 * height the stage has. The stage then has no letterbox beside the video; the viewport still fits it as usual (`fitRatio`), so
 * nothing is ever cropped.
 */
export function portraitStageWidth(ratio: number, height: number): number {
  const h = Math.max(0, Math.floor(height));
  return h === 0 ? 0 : Math.round(h * validRatio(ratio));
}
