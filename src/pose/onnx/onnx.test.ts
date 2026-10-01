import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT, LM } from '../landmarks';
import { decodeHeatmaps, decodeSimcc } from './decode';
import { cropAround, cropToImage, iou, nms, type Box } from './geometry';
import { COCO17, HALPE26, toLandmarks } from './keypointMaps';
import { decodeYolox, yoloxRows } from './yolox';

const box = (x1: number, y1: number, x2: number, y2: number, score = 1): Box => ({ x1, y1, x2, y2, score });

describe('crop', () => {
  it('widens a tall box to the input shape and pads it by 25 %', () => {
    const c = cropAround(box(100, 0, 200, 400), 0.75);
    expect(c.cx).toBe(150);
    expect(c.cy).toBe(200);
    expect(c.h).toBeCloseTo(500);
    expect(c.w).toBeCloseTo(375);
  });

  it('makes a wide box taller instead', () => {
    const c = cropAround(box(0, 100, 400, 200), 0.75);
    expect(c.w).toBeCloseTo(500);
    expect(c.h).toBeCloseTo(500 / 0.75);
  });

  it('puts the corners and the center of the model input back on the image', () => {
    const c = cropAround(box(100, 0, 200, 400), 0.75);
    expect(cropToImage(c, 192, 256, 96, 128)).toEqual({ x: c.cx, y: c.cy });
    expect(cropToImage(c, 192, 256, 0, 0)).toEqual({ x: c.cx - c.w / 2, y: c.cy - c.h / 2 });
    expect(cropToImage(c, 192, 256, 192, 256)).toEqual({ x: c.cx + c.w / 2, y: c.cy + c.h / 2 });
  });
});

describe('nms', () => {
  it('measures the overlap', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(0);
    expect(iou(box(0, 0, 10, 10), box(5, 0, 15, 10))).toBeCloseTo(1 / 3);
  });

  it('keeps the best of two boxes on the same person and both of two people', () => {
    const kept = nms([box(0, 0, 10, 10, 0.5), box(1, 1, 11, 11, 0.9), box(50, 50, 60, 60, 0.4)], 0.45);
    expect(kept.map((b) => b.score)).toEqual([0.9, 0.4]);
  });
});

describe('RTMPose decoding (SimCC)', () => {
  it('reads the best bin of each axis, halves it and averages the two scores', () => {
    const x = new Float32Array(2 * 8);
    const y = new Float32Array(2 * 10);
    x[5] = 0.9;
    y[7] = 0.7;
    x[1 * 8 + 2] = 2; // above 1: the score is clamped
    y[1 * 10 + 3] = 2;
    const { xy, scores } = decodeSimcc(x, y, 2, 8, 10, 2);
    expect(Array.from(xy)).toEqual([2.5, 3.5, 1, 1.5]);
    expect(scores[0]).toBeCloseTo(0.8);
    expect(scores[1]).toBe(1);
  });
});

describe('ViTPose decoding (heatmaps)', () => {
  it('scales the hottest cell to the input and moves a quarter cell toward the hotter neighbour', () => {
    const w = 4;
    const h = 8;
    const heat = new Float32Array(h * w);
    heat[3 * w + 1] = 0.8;
    heat[3 * w + 2] = 0.5; // the right neighbour is hotter than the left one (0)
    heat[2 * w + 1] = 0.1; // the one above is hotter than the one below (0)
    const { xy, scores } = decodeHeatmaps(heat, 1, h, w, 8, 32);
    expect(xy[0]).toBeCloseTo((1 + 0.25) * 2);
    expect(xy[1]).toBeCloseTo((3 - 0.25) * 4);
    expect(scores[0]).toBeCloseTo(0.8);
  });

  it('does not look outside the map on its edge', () => {
    const heat = new Float32Array(2 * 2);
    heat[0] = 1;
    const { xy } = decodeHeatmaps(heat, 1, 2, 2, 2, 2);
    expect(Array.from(xy)).toEqual([0, 0]);
  });
});

describe('YOLOX decoding', () => {
  it('has a row per cell of the three strides', () => {
    expect(yoloxRows(640)).toBe(8400);
  });

  it('decodes a person in a cell of the stride 8 grid to image pixels', () => {
    const size = 64;
    const out = new Float32Array(yoloxRows(size) * 85);
    const row = 1 * (size / 8) + 2; // cell (2, 1)
    const o = row * 85;
    out[o] = 0.5; // offsets are in cells
    out[o + 1] = 0.5;
    out[o + 2] = Math.log(2); // 2 strides wide, 4 high
    out[o + 3] = Math.log(4);
    out[o + 4] = 0.9;
    out[o + 5] = 0.9; // class 0: person
    const dog = (row + 1) * 85;
    out[dog + 4] = 0.9;
    out[dog + 5 + 16] = 0.9;
    const found = decodeYolox(out, size, 0.5, 4);
    expect(found).toHaveLength(1);
    expect(found[0].score).toBeCloseTo(0.81);
    // Center (2.5, 1.5) cells = (20, 12) px, 16 × 32 px, then divided by the letterbox scale 0.5.
    expect([found[0].x1, found[0].y1, found[0].x2, found[0].y2].map(Math.round)).toEqual([24, -8, 56, 56]);
  });

  it('keeps no more boxes than asked', () => {
    const size = 64;
    const out = new Float32Array(yoloxRows(size) * 85);
    for (const cell of [0, 40]) {
      const o = cell * 85;
      out[o + 4] = out[o + 5] = 0.9;
    }
    expect(decodeYolox(out, size, 1, 4)).toHaveLength(2);
    expect(decodeYolox(out, size, 1, 1)).toHaveLength(1);
  });
});

describe('keypoint maps', () => {
  it('send every model point to a different landmark', () => {
    for (const map of [COCO17, HALPE26]) {
      const used = map.filter((i) => i >= 0);
      expect(new Set(used).size).toBe(used.length);
      expect(Math.max(...used)).toBeLessThan(LANDMARK_COUNT);
    }
    expect(COCO17).toHaveLength(17);
    expect(HALPE26).toHaveLength(26);
  });

  it('fill the landmarks the model has and leave the others unseen', () => {
    const points = Array.from({ length: 26 }, (_, i) => ({ x: i, y: 2 * i, score: 0.5 }));
    const lm = toLandmarks(points, HALPE26);
    expect(lm).toHaveLength(LANDMARK_COUNT);
    expect(lm[LM.L_SHOULDER]).toEqual({ x: 5, y: 10, visibility: 0.5 });
    expect(lm[LM.L_HEEL]).toEqual({ x: 24, y: 48, visibility: 0.5 });
    expect(lm[LM.R_FOOT]).toEqual({ x: 21, y: 42, visibility: 0.5 });
    expect(lm[LM.L_PINKY].visibility).toBe(0);
    expect(lm[LM.MOUTH_L].visibility).toBe(0);
  });

  it('keep COCO left and right where BlazePose has them, and give no feet past the ankle', () => {
    const lm = toLandmarks(
      Array.from({ length: 17 }, (_, i) => ({ x: i, y: 0, score: 1 })),
      COCO17,
    );
    expect(lm[LM.L_HIP].x).toBe(11);
    expect(lm[LM.R_HIP].x).toBe(12);
    expect(lm[LM.R_ANKLE].x).toBe(16);
    expect(lm[LM.L_HEEL].visibility).toBe(0);
  });
});
