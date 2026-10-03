import type { GrayFrame } from './types';

/**
 * Pure pixel conversions between what a canvas gives (RGBA bytes) and what the detector reads (small gray pictures). They are
 * apart from the canvas code so that they can be tested without a browser.
 */

/**
 * Turns a picture of RGBA bytes, `factor` times bigger than `out` in both directions, into gray: the luma of every block of
 * factor × factor pixels averaged, 0 to 1. Averaging the block (instead of taking one pixel of it) is what keeps a picture that is much
 * bigger from shimmering when it is made small: the detector reads every change of the picture as motion.
 */
export function grayFromRgba(rgba: ArrayLike<number>, sourceWidth: number, factor: number, out: GrayFrame): void {
  const { width: w, height: h, data } = out;
  const scale = 1 / (255 * factor * factor);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) {
        let i = ((y * factor + j) * sourceWidth + x * factor) * 4;
        for (let k = 0; k < factor; k++, i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      }
      data[y * w + x] = sum * scale;
    }
  }
}

/** Writes a mask (0 to 1) as the alpha of white pixels, to be drawn over a picture as a mask. `rgba` holds 4 bytes per mask value. */
export function alphaFromMask(mask: Float32Array, rgba: Uint8ClampedArray): void {
  for (let i = 0; i < mask.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
  }
}

/** The size of the gray picture for a video: `workWidth` wide, as high as the aspect ratio of the video says (at least 16). */
export function workSize(
  videoWidth: number,
  videoHeight: number,
  workWidth: number,
): { width: number; height: number } {
  const height = Math.max(16, Math.round((workWidth * videoHeight) / Math.max(1, videoWidth)));
  return { width: workWidth, height };
}
