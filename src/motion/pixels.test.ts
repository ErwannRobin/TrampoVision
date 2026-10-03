import { describe, expect, it } from 'vitest';
import { alphaFromMask, grayFromRgba, workSize } from './pixels';
import type { GrayFrame } from './types';

/** A 4 × 4 picture of RGBA bytes: the left half white, the right half black. */
function halves(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = x < 2 ? 255 : 0;
      rgba.set([v, v, v, 255], (y * 4 + x) * 4);
    }
  }
  return rgba;
}

describe('gray from RGBA', () => {
  it('averages every block of the bigger picture', () => {
    const out: GrayFrame = { width: 2, height: 2, data: new Float32Array(4) };
    grayFromRgba(halves(), 4, 2, out);
    expect(Array.from(out.data)).toEqual([1, 0, 1, 0].map((v) => expect.closeTo(v, 5)));
  });

  it('mixes a block that is half white and half black into gray', () => {
    const out: GrayFrame = { width: 1, height: 1, data: new Float32Array(1) };
    grayFromRgba(halves(), 4, 4, out);
    expect(out.data[0]).toBeCloseTo(0.5, 5);
  });

  it('weighs the colors as the eye does (green most, blue least)', () => {
    const out: GrayFrame = { width: 1, height: 1, data: new Float32Array(1) };
    const gray = (r: number, g: number, b: number) => {
      grayFromRgba(Uint8ClampedArray.from([r, g, b, 255]), 1, 1, out);
      return out.data[0];
    };
    expect(gray(255, 255, 255)).toBeCloseTo(1, 5);
    expect(gray(0, 0, 0)).toBe(0);
    expect(gray(0, 255, 0)).toBeGreaterThan(gray(255, 0, 0));
    expect(gray(255, 0, 0)).toBeGreaterThan(gray(0, 0, 255));
  });
});

describe('alpha from a mask', () => {
  it('writes white pixels whose alpha is the mask', () => {
    const rgba = new Uint8ClampedArray(3 * 4);
    alphaFromMask(Float32Array.from([0, 0.5, 1]), rgba);
    expect(Array.from(rgba)).toEqual([255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]);
  });

  it('keeps a mask that is out of range inside it', () => {
    const rgba = new Uint8ClampedArray(2 * 4);
    alphaFromMask(Float32Array.from([-0.3, 1.4]), rgba);
    expect([rgba[3], rgba[7]]).toEqual([0, 255]);
  });
});

describe('the size of the gray picture', () => {
  it('follows the aspect ratio of the video', () => {
    expect(workSize(1920, 1080, 128)).toEqual({ width: 128, height: 72 });
    expect(workSize(1080, 1920, 128)).toEqual({ width: 128, height: 228 });
  });

  it('is never degenerate', () => {
    expect(workSize(0, 0, 128).height).toBeGreaterThanOrEqual(16);
    expect(workSize(4000, 100, 128).height).toBe(16);
  });
});
