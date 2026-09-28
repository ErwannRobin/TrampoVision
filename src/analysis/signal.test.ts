import { describe, expect, it } from 'vitest';
import { fillGaps, localPolyFit, unwrapDegrees, wrapDegrees } from './signal';

describe('localPolyFit', () => {
  it('recovers a parabola and its derivative exactly, including at the edges', () => {
    const dt = 1 / 30;
    const y = Array.from({ length: 40 }, (_, i) => 3 + 2 * (i * dt) - 4.9 * (i * dt) ** 2);
    const { value, slope } = localPolyFit(y, 7, 2);
    for (let i = 0; i < y.length; i++) {
      expect(value[i]).toBeCloseTo(y[i], 9);
      expect(slope[i] / dt).toBeCloseTo(2 - 9.8 * i * dt, 6);
    }
  });

  it('reduces noise', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const clean = Array.from({ length: 200 }, (_, i) => Math.sin(i / 15));
    const noisy = clean.map((v) => v + 0.2 * rnd());
    const { value } = localPolyFit(noisy, 9, 2);
    const err = (a: ArrayLike<number>) => Array.from(a).reduce((s, v, i) => s + (v - clean[i]) ** 2, 0);
    expect(err(value)).toBeLessThan(err(noisy) * 0.5);
  });

  it('keeps NaN gaps as NaN and handles runs shorter than the window', () => {
    const { value } = localPolyFit([1, 2, NaN, 5, 6, 7, 8], 5, 2);
    expect(Number.isNaN(value[2])).toBe(true);
    expect(value[0]).toBeCloseTo(1, 9);
    expect(value[1]).toBeCloseTo(2, 9);
    expect(value[6]).toBeCloseTo(8, 9);
  });
});

describe('fillGaps', () => {
  it('interpolates short gaps only', () => {
    const out = fillGaps([0, NaN, NaN, 3, NaN, NaN, NaN, NaN, 8], 2);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 1, 2, 3]);
    expect(Number.isNaN(out[5])).toBe(true);
  });
  it('does not extrapolate leading/trailing gaps', () => {
    const out = fillGaps([NaN, 1, 2, NaN], 3);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[3])).toBe(true);
  });
});

describe('angle wrapping', () => {
  it('wraps to (-180, 180]', () => {
    expect(wrapDegrees(190)).toBeCloseTo(-170);
    expect(wrapDegrees(-190)).toBeCloseTo(170);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
  });
  it('unwraps a full forward rotation (through a gap too)', () => {
    const wrapped = Array.from({ length: 73 }, (_, i) => wrapDegrees(i * 10));
    wrapped[30] = NaN;
    wrapped[31] = NaN;
    const out = unwrapDegrees(wrapped);
    expect(out[72]).toBeCloseTo(720, 6);
    expect(out[29]).toBeCloseTo(290, 6);
    expect(out[32]).toBeCloseTo(320, 6);
  });
});
