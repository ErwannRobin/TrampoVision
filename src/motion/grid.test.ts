import { describe, expect, it } from 'vitest';
import { boxFilter, clamp01, dilate, labelPieces, medianOf, ramp, shiftPicture, wholePixels } from './grid';

describe('ramp', () => {
  it('is 0 below the low end, 1 above the high end and a straight line between', () => {
    expect(ramp(1, 2, 6)).toBe(0);
    expect(ramp(2, 2, 6)).toBe(0);
    expect(ramp(4, 2, 6)).toBeCloseTo(0.5);
    expect(ramp(9, 2, 6)).toBe(1);
  });

  it('is a step when both ends are the same', () => {
    expect(ramp(0.4, 0.5, 0.5)).toBe(0);
    expect(ramp(0.6, 0.5, 0.5)).toBe(1);
  });

  it('clamp01 keeps a number in 0..1', () => {
    expect([clamp01(-3), clamp01(0.25), clamp01(7)]).toEqual([0, 0.25, 1]);
  });
});

describe('boxFilter', () => {
  const w = 6;
  const h = 5;

  it('sums every window of (2r + 1)², and takes the mean when asked', () => {
    const src = new Float32Array(w * h).fill(2);
    const sum = new Float32Array(w * h);
    const mean = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    boxFilter(src, sum, w, h, 1, tmp);
    boxFilter(src, mean, w, h, 1, tmp, true);
    expect(sum[2 * w + 3]).toBeCloseTo(18);
    expect(mean[2 * w + 3]).toBeCloseTo(2);
  });

  it('extends the picture by its edge pixels, so a window at the border does not shrink', () => {
    const src = new Float32Array(w * h).fill(1);
    const sum = new Float32Array(w * h);
    boxFilter(src, sum, w, h, 2, new Float32Array(w * h));
    expect(sum[0]).toBeCloseTo(25);
    expect(sum[w * h - 1]).toBeCloseTo(25);
  });

  it('spreads one bright pixel over the window around it and nowhere else', () => {
    const src = new Float32Array(w * h);
    src[2 * w + 2] = 9;
    const out = new Float32Array(w * h);
    boxFilter(src, out, w, h, 1, new Float32Array(w * h), true);
    expect(out[2 * w + 2]).toBeCloseTo(1);
    expect(out[1 * w + 1]).toBeCloseTo(1);
    expect(out[3 * w + 3]).toBeCloseTo(1);
    expect(out[0]).toBe(0);
    expect(out[2 * w + 5]).toBe(0);
  });

  it('copies the picture when the radius is 0', () => {
    const src = Float32Array.from({ length: w * h }, (_, i) => i);
    const out = new Float32Array(w * h);
    boxFilter(src, out, w, h, 0, new Float32Array(w * h));
    expect(Array.from(out)).toEqual(Array.from(src));
  });
});

describe('dilate', () => {
  it('grows the set pixels by r in every direction and stops at the border', () => {
    const w = 7;
    const h = 7;
    const src = new Uint8Array(w * h);
    src[3 * w + 3] = 1;
    const out = new Uint8Array(w * h);
    dilate(src, out, w, h, 2, new Uint8Array(w * h));
    expect(out.reduce((a, b) => a + b, 0)).toBe(25);
    expect(out[1 * w + 1]).toBe(1);
    expect(out[0]).toBe(0);

    const corner = new Uint8Array(w * h);
    corner[0] = 1;
    dilate(corner, out, w, h, 2, new Uint8Array(w * h));
    expect(out.reduce((a, b) => a + b, 0)).toBe(9);
  });
});

describe('labelPieces', () => {
  it('numbers the pieces of touching pixels and gives their areas', () => {
    const w = 6;
    const h = 4;
    // Two pieces: an L of three pixels, and a bar of two. The diagonal neighbors do not touch.
    const rows = ['##....', '#..#..', '...#..', '......'];
    const binary = Uint8Array.from(
      rows
        .join('')
        .split('')
        .map((c) => (c === '#' ? 1 : 0)),
    );
    const labels = new Int32Array(w * h);
    const areas = labelPieces(binary, labels, w, h, new Int32Array(w * h));
    expect(areas.slice(1).sort()).toEqual([2, 3]);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[0]).toBe(labels[w]);
    expect(labels[w + 3]).toBe(labels[2 * w + 3]);
    expect(labels[0]).not.toBe(labels[w + 3]);
    expect(labels[w + 1]).toBe(0);
  });

  it('finds nothing in an empty picture', () => {
    expect(labelPieces(new Uint8Array(12), new Int32Array(12), 4, 3, new Int32Array(12))).toEqual([0]);
  });
});

describe('medianOf', () => {
  it('is the middle value, to the width of a bin', () => {
    const values = Float32Array.from({ length: 101 }, (_, i) => i / 1000);
    expect(medianOf(values, 0.25, 1024)).toBeCloseTo(0.05, 3);
  });

  it('is not moved by a few big values', () => {
    const values = new Float32Array(100).fill(0.004);
    values.fill(0.9, 90);
    expect(medianOf(values, 0.25, 1024)).toBeCloseTo(0.004, 3);
  });
});

describe('shiftPicture', () => {
  const w = 4;
  const h = 3;
  // 0  1  2  3
  // 4  5  6  7
  // 8  9 10 11
  const src = Float32Array.from({ length: w * h }, (_, i) => i);
  const shifted = (sx: number, sy: number, fill: number | null) => {
    const dst = new Float32Array(w * h);
    shiftPicture(src, dst, w, h, sx, sy, fill);
    return Array.from(dst);
  };

  it('moves the picture right and down by whole pixels, and fills what comes into view', () => {
    expect(shifted(1, 1, -1)).toEqual([-1, -1, -1, -1, -1, 0, 1, 2, -1, 4, 5, 6]);
  });

  it('moves it left and up the same way', () => {
    expect(shifted(-2, -1, -1)).toEqual([6, 7, -1, -1, 10, 11, -1, -1, -1, -1, -1, -1]);
  });

  it('leaves it alone for no move, and clears it for a move of the whole picture or more', () => {
    expect(shifted(0, 0, -1)).toEqual(Array.from(src));
    expect(shifted(4, 0, -1).every((v) => v === -1)).toBe(true);
    expect(shifted(0, -3, -1).every((v) => v === -1)).toBe(true);
  });

  it('goes on with the nearest pixel past the edge when there is no fill value', () => {
    expect(shifted(1, 1, null)).toEqual([0, 0, 1, 2, 0, 0, 1, 2, 4, 4, 5, 6]);
    expect(shifted(0, -1, null)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 8, 9, 10, 11]);
    expect(shifted(9, 0, null)).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 8, 8, 8, 8]);
  });

  it('works on byte pictures', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const out = new Uint8Array(6);
    shiftPicture(bytes, out, 3, 2, 1, 0, 0);
    expect(Array.from(out)).toEqual([0, 1, 2, 0, 4, 5]);
  });
});

describe('wholePixels', () => {
  it('hands out whole pixels and keeps the rest for the next move', () => {
    const rest = { value: 0 };
    expect([0.4, 0.4, 0.4, 0.4, 0.4].map((m) => wholePixels(rest, m))).toEqual([0, 1, 0, 1, 0]);
    expect(rest.value).toBeCloseTo(0);
  });

  it('works for moves the other way', () => {
    const rest = { value: 0 };
    expect([-0.6, -0.6, -0.6].map((m) => wholePixels(rest, m))).toEqual([-1, 0, -1]);
  });
});
