import { describe, expect, it } from 'vitest';
import { ShotCutDetector } from './shotCut';
import type { GrayFrame } from './types';

const W = 48;
const H = 27;

/** A picture of vertical stripes of two gray levels, moved by `shift` pixels. */
function stripes(low: number, high: number, shift = 0): GrayFrame {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data[y * W + x] = Math.floor((x + shift) / 12) % 2 === 0 ? low : high;
  }
  return { width: W, height: H, data };
}

describe('the cut detector', () => {
  it('sees nothing in a still picture, and in a picture that slides a little each frame', () => {
    const cuts = new ShotCutDetector();
    expect(cuts.push(stripes(0.2, 0.7))).toBe(false);
    expect(cuts.push(stripes(0.2, 0.7))).toBe(false);
    for (let shift = 1; shift <= 3; shift++) expect(cuts.push(stripes(0.2, 0.7, shift))).toBe(false);
  });

  it('sees a cut when the whole picture is another one at once', () => {
    const cuts = new ShotCutDetector();
    cuts.push(stripes(0.2, 0.7));
    expect(cuts.push(stripes(0.05, 0.15))).toBe(true);
    expect(cuts.push(stripes(0.05, 0.15))).toBe(false);
  });

  it('sees a cut between two scenes with the same lights, where the picture itself is not alike at all', () => {
    const cuts = new ShotCutDetector();
    cuts.push(stripes(0.2, 0.7));
    expect(cuts.push(stripes(0.7, 0.2))).toBe(true);
  });

  it('has no frame before the first one to cut from, and forgets it when reset', () => {
    const cuts = new ShotCutDetector();
    expect(cuts.push(stripes(0.2, 0.7))).toBe(false);
    cuts.reset();
    expect(cuts.push(stripes(0.05, 0.15))).toBe(false);
  });
});
