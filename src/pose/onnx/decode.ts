/** Turns the raw output of a pose model into points of its input image. Pure functions on typed arrays. */

export interface Decoded {
  /** x, y per keypoint, in pixels of the model's input. */
  xy: Float32Array;
  /** Per keypoint, in [0, 1]. */
  scores: Float32Array;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * RTMPose (SimCC): one 1D classification per axis and keypoint, finer than the input by `ratio` (2 for the released models).
 * Location = the best bin / ratio; score = the mean of the two best responses, as in rtmlib / MMPose.
 */
export function decodeSimcc(
  simccX: Float32Array,
  simccY: Float32Array,
  keypoints: number,
  binsX: number,
  binsY: number,
  ratio = 2,
): Decoded {
  const xy = new Float32Array(keypoints * 2);
  const scores = new Float32Array(keypoints);
  for (let k = 0; k < keypoints; k++) {
    let bx = 0;
    let by = 0;
    let vx = -Infinity;
    let vy = -Infinity;
    for (let i = 0; i < binsX; i++) {
      const v = simccX[k * binsX + i];
      if (v > vx) {
        vx = v;
        bx = i;
      }
    }
    for (let i = 0; i < binsY; i++) {
      const v = simccY[k * binsY + i];
      if (v > vy) {
        vy = v;
        by = i;
      }
    }
    xy[2 * k] = bx / ratio;
    xy[2 * k + 1] = by / ratio;
    scores[k] = clamp01((vx + vy) / 2);
  }
  return { xy, scores };
}

/**
 * ViTPose (heatmaps): the hottest cell, moved a quarter of a cell toward the hotter neighbour (the standard MMPose refinement),
 * then scaled to the model's input. Score = the heat of that cell.
 */
export function decodeHeatmaps(
  heat: Float32Array,
  keypoints: number,
  height: number,
  width: number,
  inputW: number,
  inputH: number,
): Decoded {
  const xy = new Float32Array(keypoints * 2);
  const scores = new Float32Array(keypoints);
  const cells = width * height;
  for (let k = 0; k < keypoints; k++) {
    const base = k * cells;
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < cells; i++) {
      const v = heat[base + i];
      if (v > best) {
        best = v;
        at = i;
      }
    }
    const px = at % width;
    const py = Math.floor(at / width);
    let x = px;
    let y = py;
    if (px > 0 && px < width - 1) x += Math.sign(heat[base + at + 1] - heat[base + at - 1]) * 0.25;
    if (py > 0 && py < height - 1) y += Math.sign(heat[base + at + width] - heat[base + at - width]) * 0.25;
    xy[2 * k] = x * (inputW / width);
    xy[2 * k + 1] = y * (inputH / height);
    scores[k] = clamp01(best);
  }
  return { xy, scores };
}
