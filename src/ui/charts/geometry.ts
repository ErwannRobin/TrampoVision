import { formatDecimal } from '../../i18n/core';
import type { ChartGuide, ChartSeries } from './types';

/** Pure geometry of the charts: ticks, ranges, scales and runs of samples. No DOM, so it can be tested. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Round tick values inside [min, max], about `target` of them. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const span = max - min || 1;
  const raw = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const out: number[] = [];
  // Multiples of the step, not a running sum: 0.1 + 0.2 never shows up as 0.30000000000000004.
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-6; k++)
    out.push(k === 0 ? 0 : Number((k * step).toPrecision(12)));
  return out;
}

/** Smallest and largest finite value; null when there is none. (No spread: a long clip must not overflow the stack.) */
export function finiteExtent(values: ArrayLike<number>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** The y range of a chart: the data, the guides and the zero line, at least `minSpan` tall, with a little air. */
export function chartDomain(
  series: readonly ChartSeries[],
  {
    zeroLine = false,
    minSpan = 1e-6,
    guides = [],
  }: { zeroLine?: boolean; minSpan?: number; guides?: readonly ChartGuide[] } = {},
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const e = finiteExtent(s.values);
    if (!e) continue;
    lo = Math.min(lo, e[0]);
    hi = Math.max(hi, e[1]);
  }
  if (!Number.isFinite(lo)) return [0, 1];
  for (const g of guides) {
    lo = Math.min(lo, g.value);
    hi = Math.max(hi, g.value);
  }
  if (zeroLine) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < minSpan) {
    const c = (hi + lo) / 2;
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/** Index of the sample nearest to `t`, for evenly spaced samples. */
export function indexAt(time: ArrayLike<number>, t: number): number {
  if (time.length < 2 || !Number.isFinite(t)) return 0;
  const dt = (time[time.length - 1] - time[0]) / (time.length - 1);
  if (!(dt > 0)) return 0;
  return clamp(Math.round((t - time[0]) / dt), 0, time.length - 1);
}

/** Index ranges [from, to] of consecutive drawable samples: a gap, or a step above `breakAbove`, lifts the pen. */
export function lineRuns(values: ArrayLike<number>, breakAbove?: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      if (start >= 0) out.push([start, i - 1]);
      start = -1;
    } else if (start < 0) {
      start = i;
    } else if (breakAbove !== undefined && Math.abs(v - values[i - 1]) > breakAbove) {
      out.push([start, i - 1]);
      start = i;
    }
  }
  if (start >= 0) out.push([start, values.length - 1]);
  return out;
}

/** Index ranges [from, to] of consecutive samples that are not at or above `limit` (a missing value counts as below). */
export function belowRuns(values: ArrayLike<number>, limit: number, count = values.length): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < count; i++) {
    const below = !(values[i] >= limit);
    if (below && start < 0) start = i;
    if (!below && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, count - 1]);
  return out;
}

export interface Margin {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A chart's plot area and the maps between data and pixels (CSS pixels, y down). */
export interface Plot {
  width: number;
  height: number;
  box: { x0: number; x1: number; y0: number; y1: number };
  t0: number;
  t1: number;
  lo: number;
  hi: number;
  px: (t: number) => number;
  py: (v: number) => number;
  /** x value under a horizontal pixel position, held inside the plot. */
  xAt: (pixel: number) => number;
}

export function makePlot(
  width: number,
  height: number,
  margin: Margin,
  [t0, t1]: readonly [number, number],
  [lo, hi]: readonly [number, number],
): Plot {
  const box = { x0: margin.left, x1: width - margin.right, y0: margin.top, y1: height - margin.bottom };
  const spanX = box.x1 - box.x0;
  return {
    width,
    height,
    box,
    t0,
    t1,
    lo,
    hi,
    px: (t) => box.x0 + ((t - t0) / (t1 - t0 || 1)) * spanX,
    py: (v) => box.y1 - ((v - lo) / (hi - lo || 1)) * (box.y1 - box.y0),
    xAt: (pixel) => t0 + clamp((pixel - box.x0) / (spanX || 1), 0, 1) * (t1 - t0),
  };
}

/** An axis label: plain digits (the decimal mark of the language), a real minus sign, no trailing zeros. */
export function tickLabel(v: number): string {
  const s = formatDecimal(Number(v.toFixed(2)), 2);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

export const timeLabel = (seconds: number) => `${tickLabel(seconds)}s`;
