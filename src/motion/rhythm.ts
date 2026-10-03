import type { MotionConfig } from './config';

/** The most frames a second the rhythm keeps room for. */
const MAX_FPS = 120;
/** A peak of the autocorrelation this close to the highest one is the period itself, not a multiple of it. */
const FUNDAMENTAL = 0.8;
/** A signal that repeats at a period repeats at twice that period too, at least this well. Two similar events do not. */
const HARMONIC = 0.5;
/** Periods that must fit in the window before one counts: two to see it repeat, and a half to see that it repeats again. */
const PERIODS_NEEDED = 2.5;
/** Samples every lag of the autocorrelation must still overlap by. */
const MIN_OVERLAP = 8;

export interface RhythmReading {
  /** Per column, 0 to 1: how well its vertical motion repeats at a jump's pace (the autocorrelation at the best period). */
  strength: Float32Array;
  /** The jump period read from the columns that move, seconds; null when nothing repeats. */
  periodS: number | null;
  /** How well that period fits, 0 to 1. */
  fit: number;
}

/**
 * Is the vertical motion in a column periodic? Every frame the detector pushes one number per column: which way things move
 * in it (-1 up, +1 down). An athlete jumping in a column makes that number go up and down once per jump, so its autocorrelation has a
 * peak at the jump period, after a dip below zero (it went to the other side), and again at twice that period. A person walking by, a
 * flag, a shaking camera or the noise of the video do not: they do not repeat at that pace, they never go to the other side, or they
 * happened twice (two events the same time apart correlate well, but there is no third).
 *
 * The autocorrelation of a column is the normalized one over the part of the window that overlaps itself, after taking the mean
 * out (a drift is not a rhythm).
 */
export class ColumnRhythm {
  private readonly capacity: number;
  /** Column-major ring buffer: the samples of column x are at x * capacity ... (x + 1) * capacity - 1. */
  private readonly samples: Float32Array;
  private readonly strength: Float32Array;
  private readonly seq: Float32Array;
  private readonly power: Float64Array;
  private readonly curve: Float64Array;
  private readonly sum: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(
    readonly width: number,
    private readonly cfg: MotionConfig,
  ) {
    this.capacity = Math.ceil(cfg.rhythmWindowS * MAX_FPS);
    this.samples = new Float32Array(width * this.capacity);
    this.strength = new Float32Array(width);
    this.seq = new Float32Array(this.capacity);
    this.power = new Float64Array(this.capacity + 1);
    this.curve = new Float64Array(this.capacity + 1);
    this.sum = new Float64Array(this.capacity + 1);
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.strength.fill(0);
  }

  /**
   * Moves what is known about the columns `columns` to the right (to the left when negative), because the camera moved: the column
   * that showed the athlete now sits there. The columns that come into view know nothing, and start again.
   */
  shift(columns: number): void {
    const { width, capacity } = this;
    if (columns === 0) return;
    if (Math.abs(columns) >= width) {
      this.samples.fill(0);
      this.strength.fill(0);
      return;
    }
    if (columns > 0) {
      this.samples.copyWithin(columns * capacity, 0, (width - columns) * capacity);
      this.samples.fill(0, 0, columns * capacity);
      this.strength.copyWithin(columns, 0, width - columns);
      this.strength.fill(0, 0, columns);
    } else {
      this.samples.copyWithin(0, -columns * capacity, width * capacity);
      this.samples.fill(0, (width + columns) * capacity);
      this.strength.copyWithin(0, -columns, width);
      this.strength.fill(0, width + columns);
    }
  }

  /** Adds one sample per column (length `width`). */
  push(direction: Float32Array): void {
    for (let x = 0; x < this.width; x++) this.samples[x * this.capacity + this.head] = direction[x];
    this.head = (this.head + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  /** Reads the rhythm of every column from the last `rhythmWindowS` seconds. `fps` is the rate the samples come at. */
  read(fps: number): RhythmReading {
    const { cfg, width, seq, power, curve, sum } = this;
    const n = Math.min(this.filled, Math.round(cfg.rhythmWindowS * fps));
    const lagMin = Math.max(2, Math.round(cfg.minPeriodS * fps));
    const lagMax = Math.min(Math.round(cfg.maxPeriodS * fps), Math.floor((n - MIN_OVERLAP) / PERIODS_NEEDED));
    this.strength.fill(0);
    if (lagMax < lagMin) return { strength: this.strength, periodS: null, fit: 0 };
    // The curve goes to twice the longest period, to see that a period repeats.
    const curveMax = Math.min(2 * lagMax + 2, n - MIN_OVERLAP);

    // The autocorrelation of the columns that have a rhythm, added up weighted by their power: where the common period shows.
    sum.fill(0, 0, curveMax + 1);
    let weight = 0;
    for (let x = 0; x < width; x++) {
      let mean = 0;
      const base = x * this.capacity;
      for (let t = 0; t < n; t++) {
        const v = this.samples[base + ((this.head - n + t + 2 * this.capacity) % this.capacity)];
        seq[t] = v;
        mean += v;
      }
      mean /= n;
      let energy = 0;
      for (let t = 0; t < n; t++) {
        seq[t] -= mean;
        energy += seq[t] * seq[t];
        power[t + 1] = energy;
      }
      if (energy / n < cfg.minActivity) continue;

      autocorrelation(seq, power, n, curveMax, curve);
      this.strength[x] = bestPeak(curve, lagMin, lagMax, curveMax, cfg.minTrough).fit;
      // Only the columns that have a rhythm say what the period is: the rest would only blur it.
      if (this.strength[x] < cfg.minRhythm) continue;
      for (let lag = 2; lag <= curveMax; lag++) sum[lag] += energy * curve[lag];
      weight += energy;
    }
    if (weight === 0) return { strength: this.strength, periodS: null, fit: 0 };
    for (let lag = 2; lag <= curveMax; lag++) curve[lag] = sum[lag] / weight;
    const peak = bestPeak(curve, lagMin, lagMax, curveMax, cfg.minTrough);
    return { strength: this.strength, periodS: peak.lag > 0 ? peak.lag / fps : null, fit: peak.fit };
  }
}

/** Normalized autocorrelation at lags 2 to `lagMax` into `curve`; `power[k]` is the sum of the squares of the first k samples. */
function autocorrelation(seq: Float32Array, power: Float64Array, n: number, lagMax: number, curve: Float64Array): void {
  for (let lag = 2; lag <= lagMax; lag++) {
    let cross = 0;
    for (let t = lag; t < n; t++) cross += seq[t] * seq[t - lag];
    const scale = Math.sqrt((power[n] - power[lag]) * power[n - lag]);
    curve[lag] = scale > 1e-12 ? cross / scale : 0;
  }
}

/**
 * The period of an autocorrelation curve (lags 2 to `curveMax`): the first peak up to `lagMax` that is nearly as high as the highest
 * one after the curve went below minus `minTrough` (going to the other side of the mean, not a slow drift), and that comes back at twice
 * the lag. The first peak, because a signal that repeats every 0.5 s repeats every 1 s too: a hand that waves is not a jump.
 * `lag` is 0 when there is no such peak, or when the period is shorter than `lagMin`.
 */
function bestPeak(
  curve: Float64Array,
  lagMin: number,
  lagMax: number,
  curveMax: number,
  minTrough: number,
): { lag: number; fit: number } {
  const none = { lag: 0, fit: 0 };
  let trough = 0;
  for (let l = 2; l <= lagMax && !trough; l++) if (curve[l] < -minTrough) trough = l;
  if (!trough) return none;
  let top = 0;
  for (let l = trough; l <= lagMax; l++) top = Math.max(top, curve[l]);
  if (top <= 0) return none;
  for (let l = trough + 1; l < lagMax; l++) {
    if (curve[l] < FUNDAMENTAL * top || curve[l] < curve[l - 1] || curve[l] < curve[l + 1]) continue;
    if (l < lagMin) return none;
    // It must come back at twice the lag (a frame or two either side: the jumps are not exactly alike).
    let again = -1;
    for (let k = 2 * l - 2; k <= Math.min(curveMax, 2 * l + 2); k++) again = Math.max(again, curve[k]);
    return again >= HARMONIC * curve[l] ? { lag: l, fit: Math.min(1, curve[l]) } : none;
  }
  return none;
}
