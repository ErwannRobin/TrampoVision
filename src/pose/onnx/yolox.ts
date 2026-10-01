import { nms, type Box } from './geometry';

/** Decoding the official YOLOX ONNX (the raw head: [1, cells, 85]). Pure functions; the model part is in detector.ts. */

const STRIDES = [8, 16, 32];
/** Candidates below this are not looked at (a person in mid-air, upside down, scores lower than one standing). */
export const PERSON_SCORE = 0.3;
export const NMS_IOU = 0.45;
const PERSON_CLASS = 0;
const FIELDS = 85;

/**
 * Raw head → person boxes in the pixels of the image given to `letterbox` (`ratio` is the letterbox's scale).
 * Each row: x, y (offset in the cell), log w, log h, objectness, 80 class scores; the head already applied the sigmoids.
 */
export function decodeYolox(output: Float32Array, size: number, ratio: number, maxBoxes: number): Box[] {
  const candidates: Box[] = [];
  let row = 0;
  for (const stride of STRIDES) {
    const n = size / stride;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++, row++) {
        const o = row * FIELDS;
        const score = output[o + 4] * output[o + 5 + PERSON_CLASS];
        if (score < PERSON_SCORE) continue;
        const cx = (output[o] + gx) * stride;
        const cy = (output[o + 1] + gy) * stride;
        const w = Math.exp(output[o + 2]) * stride;
        const h = Math.exp(output[o + 3]) * stride;
        candidates.push({
          x1: (cx - w / 2) / ratio,
          y1: (cy - h / 2) / ratio,
          x2: (cx + w / 2) / ratio,
          y2: (cy + h / 2) / ratio,
          score,
        });
      }
    }
  }
  return nms(candidates, NMS_IOU).slice(0, maxBoxes);
}

/** Number of rows the head has for a square input of `size` pixels. */
export const yoloxRows = (size: number) => STRIDES.reduce((sum, s) => sum + (size / s) ** 2, 0);
