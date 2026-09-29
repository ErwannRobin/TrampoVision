import { describe, expect, it } from 'vitest';
import { fillGaps, findPeaks, localPolyFit, spikeMask, unwrapDegrees, wrapDegrees } from './signal';

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

describe('weighted localPolyFit', () => {
  it('ignores zero-weight samples and follows heavily weighted ones', () => {
    const y = Array.from({ length: 21 }, (_, i) => 2 * i);
    const w = new Array(21).fill(1);
    y[10] = 500; // glitch
    w[10] = 0;
    const { value } = localPolyFit(y, 9, 2, w);
    expect(value[10]).toBeCloseTo(20, 6);
    expect(value[9]).toBeCloseTo(18, 6);
  });

  it('matches the unweighted fit when all weights are equal', () => {
    const y = Array.from({ length: 30 }, (_, i) => Math.sin(i / 4));
    const a = localPolyFit(y, 7, 2);
    const b = localPolyFit(y, 7, 2, new Array(30).fill(0.37));
    for (let i = 0; i < 30; i++) expect(b.value[i]).toBeCloseTo(a.value[i], 9);
  });
});

describe('unwrapDegrees (continuous orientation)', () => {
  it('350 -> 355 -> 360 -> 365 (input already in 0..360 style)', () => {
    const u = unwrapDegrees([350, 355, 0, 5]);
    expect(u[0]).toBe(350);
    expect(u[1]).toBe(355);
    expect(u[2]).toBe(360);
    expect(u[3]).toBe(365);
  });

  it('counts a backward rotation as negative and multiple turns', () => {
    const truth = Array.from({ length: 90 }, (_, i) => -20 * i); // -1780 deg
    const u = unwrapDegrees(truth.map(wrapDegrees));
    expect(u[89] - u[0]).toBeCloseTo(truth[89] - truth[0], 6);
  });

  it('survives a dropout longer than half a turn when the rate is steady', () => {
    const rate = 30; // deg/sample -> 7 missing samples = 240 deg, ambiguous for a plain shortest-step unwrap
    const truth = Array.from({ length: 40 }, (_, i) => rate * i);
    const wrapped = truth.map(wrapDegrees);
    for (let i = 15; i < 22; i++) wrapped[i] = NaN;
    const u = unwrapDegrees(wrapped);
    expect(u[39]).toBeCloseTo(truth[39], 6);
    expect(u[22]).toBeCloseTo(truth[22], 6);
  });

  it('also handles steps close to 180 deg/sample once the rate is established', () => {
    const truth = Array.from({ length: 30 }, (_, i) => 140 * i);
    const u = unwrapDegrees(truth.map(wrapDegrees));
    expect(u[29]).toBeCloseTo(truth[29], 6);
  });
});

describe('spikeMask', () => {
  it('flags isolated glitches but not smooth fast motion', () => {
    const n = 60;
    const xs = Array.from({ length: n }, (_, i) => 100 + 6 * i);
    const ys = Array.from({ length: n }, (_, i) => 300 - 8 * i + (0.5 * i * i) / 10);
    xs[20] += 90;
    ys[41] -= 120;
    xs[42] += 100; // two-sample glitch
    ys[42] -= 100;
    const m = spikeMask(xs, ys, 3, 40);
    const flagged = Array.from(m)
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    expect(flagged).toEqual([20, 41, 42]);
  });

  it('skips samples without enough neighbours instead of guessing', () => {
    const m = spikeMask([0, NaN, 500, NaN], [0, NaN, 500, NaN], 3, 10);
    expect(Array.from(m)).toEqual([0, 0, 0, 0]);
  });
});

describe('findPeaks', () => {
  it('finds prominent maxima, ignores ripples and respects min distance', () => {
    const y = Array.from(
      { length: 200 },
      (_, i) => Math.max(0, 3 * Math.sin((i / 200) * 6 * Math.PI)) + 0.05 * Math.sin(i * 2.7),
    );
    const peaks = findPeaks(y, 1, 20);
    expect(peaks.length).toBe(3);
    expect(Math.abs(peaks[0] - 17)).toBeLessThanOrEqual(2);
  });

  it('handles plateaus and treats NaN as a wall', () => {
    expect(findPeaks([0, 1, 2, 2, 2, 1, 0], 0.5)).toEqual([3]);
    expect(findPeaks([0, 5, 0, NaN, 0, 4, 0], 1)).toEqual([1, 5]);
  });

  it('does not report the first or last sample as a peak (the rise or fall is cut off)', () => {
    expect(findPeaks([3, 2, 1, 0, 1], 0.5)).toEqual([]);
    expect(findPeaks([0, 1, 2, 3], 0.5)).toEqual([]);
  });
});

describe('fillGaps quadratic', () => {
  it('follows a ballistic arc through a gap (linear would shave the apex)', () => {
    const dt = 1 / 30;
    const y = Array.from({ length: 40 }, (_, i) => 5 * (i * dt) - 4.905 * (i * dt) ** 2);
    const gappy = y.slice();
    for (let i = 14; i < 22; i++) gappy[i] = NaN;
    const quad = fillGaps(gappy, 10, 'quadratic');
    const lin = fillGaps(gappy, 10, 'linear');
    let eq = 0;
    let el = 0;
    for (let i = 14; i < 22; i++) {
      eq = Math.max(eq, Math.abs(quad[i] - y[i]));
      el = Math.max(el, Math.abs(lin[i] - y[i]));
    }
    expect(eq).toBeLessThan(1e-9);
    expect(el).toBeGreaterThan(0.05);
  });

  it('falls back to a straight line when there is not enough context, and never fills long gaps', () => {
    const v = [1, 2, NaN, NaN, 5, 6];
    expect(Array.from(fillGaps(v, 3, 'quadratic')).map((x) => Number(x.toFixed(6)))).toEqual([1, 2, 3, 4, 5, 6]);
    const long = [0, 1, 2, 3, NaN, NaN, NaN, NaN, NaN, 9, 10, 11, 12];
    expect(Number.isNaN(fillGaps(long, 3, 'quadratic')[6])).toBe(true);
  });
});
