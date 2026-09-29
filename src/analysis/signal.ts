/** Small signal-processing helpers. All of them tolerate NaN gaps (missing samples). */

export function median(values: ArrayLike<number>): number {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Odd number of samples covering roughly `seconds`, at least `min`. */
export function oddWindow(seconds: number, fps: number, min = 5): number {
  let n = Math.round(seconds * fps);
  if (n % 2 === 0) n += 1;
  return Math.max(min, n);
}

/**
 * Fills NaN gaps of at most `maxGap` samples that have a valid sample on both sides. Longer gaps (and
 * leading/trailing gaps) stay NaN so we never invent long stretches.
 *  - 'linear': straight line between the two ends.
 *  - 'quadratic': fits a parabola to the (up to) 4 valid samples on each side and follows it through the
 *    gap, nudged so it meets both end samples exactly. A jump or a limb in free flight follows a
 *    parabola, so this does not shave the apex the way a straight line would.
 */
export function fillGaps(values: ArrayLike<number>, maxGap: number, method: 'linear' | 'quadratic' = 'linear'): Float64Array {
  const out = Float64Array.from(values);
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (Number.isFinite(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !Number.isFinite(out[j])) j++;
    const gap = j - i;
    if (i > 0 && j < n && gap <= maxGap) {
      const a = out[i - 1];
      const b = out[j];
      const parabola = method === 'quadratic' ? fitParabola(out, i, j) : null;
      const span = gap + 1;
      for (let k = i; k < j; k++) {
        const line = a + ((b - a) * (k - i + 1)) / span;
        if (!parabola) {
          out[k] = line;
          continue;
        }
        const u0 = -1; // sample i-1 is the local origin's left end (u = k - i)
        const resA = a - parabola(u0);
        const resB = b - parabola(gap);
        const f = (k - i + 1) / span;
        out[k] = parabola(k - i) + resA + (resB - resA) * f;
      }
    }
    i = j;
  }
  return out;
}

/** Least-squares parabola through up to 4 valid samples on each side of the gap [i, j), as a function of u = k - i. */
function fitParabola(v: ArrayLike<number>, i: number, j: number): ((u: number) => number) | null {
  const us: number[] = [];
  const ys: number[] = [];
  for (let k = i - 1; k >= 0 && us.length < 4 && Number.isFinite(v[k]); k--) {
    us.push(k - i);
    ys.push(v[k]);
  }
  const left = us.length;
  for (let k = j; k < v.length && us.length < left + 4 && Number.isFinite(v[k]); k++) {
    us.push(k - i);
    ys.push(v[k]);
  }
  if (us.length < 4) return null;
  const A = new Array<number>(9).fill(0);
  const rhs = [0, 0, 0];
  for (let m = 0; m < us.length; m++) {
    const pw = [1, us[m], us[m] * us[m], us[m] ** 3, us[m] ** 4];
    for (let r = 0; r < 3; r++) {
      rhs[r] += pw[r] * ys[m];
      for (let c = 0; c < 3; c++) A[r * 3 + c] += pw[r + c];
    }
  }
  const c = solveLinearSystem(A, rhs, 3);
  return c ? (u) => c[0] + c[1] * u + c[2] * u * u : null;
}

/** Solves A c = b in place (Gaussian elimination, partial pivoting). A is m x m row-major. */
export function solveLinearSystem(A: number[], b: number[], m: number): number[] | null {
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r * m + col]) > Math.abs(A[piv * m + col])) piv = r;
    if (Math.abs(A[piv * m + col]) < 1e-12) return null;
    if (piv !== col) {
      for (let k = 0; k < m; k++) [A[col * m + k], A[piv * m + k]] = [A[piv * m + k], A[col * m + k]];
      [b[col], b[piv]] = [b[piv], b[col]];
    }
    for (let r = col + 1; r < m; r++) {
      const f = A[r * m + col] / A[col * m + col];
      for (let k = col; k < m; k++) A[r * m + k] -= f * A[col * m + k];
      b[r] -= f * b[col];
    }
  }
  const c = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < m; k++) s -= A[r * m + k] * c[k];
    c[r] = s / A[r * m + r];
  }
  return c;
}

export interface LocalFit {
  /** Smoothed value. */
  value: Float64Array;
  /** First derivative per sample (multiply by fps to get units/second). */
  slope: Float64Array;
}

/**
 * Savitzky–Golay style smoothing done as a local least-squares polynomial fit, so it also works at
 * the edges (the window slides inward instead of padding) and inside short valid runs.
 * Every contiguous run of finite samples is processed independently. Optional `weights` (>= 0, one per
 * sample) make confident samples count more than doubtful ones (weighted least squares).
 */
export function localPolyFit(
  values: ArrayLike<number>,
  window: number,
  order = 2,
  weights?: ArrayLike<number>,
): LocalFit {
  const n = values.length;
  const value = new Float64Array(n).fill(NaN);
  const slope = new Float64Array(n).fill(NaN);

  let start = 0;
  while (start < n) {
    if (!Number.isFinite(values[start])) {
      start++;
      continue;
    }
    let end = start;
    while (end < n && Number.isFinite(values[end])) end++;
    fitRun(values, weights, start, end, window, order, value, slope);
    start = end;
  }
  return { value, slope };
}

function fitRun(
  y: ArrayLike<number>,
  weights: ArrayLike<number> | undefined,
  start: number,
  end: number,
  window: number,
  order: number,
  value: Float64Array,
  slope: Float64Array,
) {
  const n = end - start;
  if (n === 1) {
    value[start] = y[start];
    return;
  }
  let w = Math.min(window, n);
  if (w % 2 === 0) w -= 1;
  const p = Math.min(order, w - 1);
  const m = p + 1;

  for (let i = 0; i < n; i++) {
    const s = Math.min(Math.max(i - (w >> 1), 0), n - w); // window start, slid to stay inside the run
    const A = new Array<number>(m * m).fill(0);
    const b = new Array<number>(m).fill(0);
    for (let j = s; j < s + w; j++) {
      const u = j - i;
      const yj = y[start + j];
      const wj = weights ? Math.max(0, weights[start + j]) : 1;
      const pw = new Array<number>(2 * m - 1);
      pw[0] = 1;
      for (let k = 1; k < pw.length; k++) pw[k] = pw[k - 1] * u;
      for (let r = 0; r < m; r++) {
        b[r] += wj * pw[r] * yj;
        for (let c = 0; c < m; c++) A[r * m + c] += wj * pw[r + c];
      }
    }
    const c = solveLinearSystem(A, b, m);
    if (c) {
      value[start + i] = c[0];
      slope[start + i] = m > 1 ? c[1] : 0;
    } else {
      value[start + i] = y[start + i];
    }
  }
}

/** Wraps an angle in degrees to (-180, 180]. */
export function wrapDegrees(a: number): number {
  let r = ((a + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}

/** Largest per-sample angular rate (deg/sample) that is trusted when predicting across gaps. */
const MAX_PREDICTED_RATE = 150;

/**
 * Makes a wrapped-angle series continuous (cumulative rotation): 350 -> 355 -> 0 becomes
 * 350 -> 355 -> 360. Each sample is put on the 360°-branch closest to where the rotation was
 * heading (last valid value + recent rate * elapsed samples). Across a dropout this keeps counting
 * correctly even when the body turned more than 180° while nobody was detected, as long as the
 * rotation rate did not change much during the gap.
 */
export function unwrapDegrees(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  const steps: number[] = []; // recent per-sample steps, newest last
  let prevIdx = -1;
  let prevOut = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (prevIdx < 0) {
      out[i] = v;
    } else {
      const elapsed = i - prevIdx;
      const rate = steps.length ? Math.min(Math.max(median(steps), -MAX_PREDICTED_RATE), MAX_PREDICTED_RATE) : 0;
      const predicted = prevOut + rate * elapsed;
      out[i] = v + 360 * Math.round((predicted - v) / 360);
      if (elapsed === 1) {
        steps.push(out[i] - prevOut);
        if (steps.length > 3) steps.shift();
      }
    }
    prevIdx = i;
    prevOut = out[i];
  }
  return out;
}

/**
 * Flags samples that jump away from their neighbours (glitches, not real motion). A sample is a
 * spike when its (x, y) position is farther than `threshold` from the median position of the valid
 * samples within +/- `half` indices. Median-based, so a run of up to `half` bad samples is caught.
 * Samples without a valid neighbour on both sides are never flagged.
 */
export function spikeMask(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  half: number,
  threshold: number,
): Uint8Array {
  const n = xs.length;
  const mask = new Uint8Array(n);
  const wx: number[] = [];
  const wy: number[] = [];
  const valid = (j: number) => Number.isFinite(xs[j]) && Number.isFinite(ys[j]);
  for (let i = 0; i < n; i++) {
    if (!valid(i)) continue;
    wx.length = 0;
    wy.length = 0;
    let before = 0;
    let after = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (!valid(j)) continue;
      wx.push(xs[j]);
      wy.push(ys[j]);
      if (j < i) before++;
      else if (j > i) after++;
    }
    // Judge only samples with context on both sides: with a one-sided window, fast but real
    // motion (the median lags behind the path) would look like a glitch.
    if (before < 1 || after < 1) continue;
    if (Math.hypot(xs[i] - median(wx), ys[i] - median(wy)) > threshold) mask[i] = 1;
  }
  return mask;
}

/**
 * Local maxima with a minimum prominence (how far the peak rises above the higher of the two
 * valleys that separate it from a taller point, or from the ends of its run of valid samples) and a
 * minimum spacing. Returns indices, ascending. NaN samples act as walls.
 */
export function findPeaks(values: ArrayLike<number>, minProminence: number, minDistance = 1): number[] {
  const n = values.length;
  const candidates: { i: number; prominence: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    // Plateau [a, b] of equal values around i; judge each plateau once, at its middle.
    let a = i;
    while (a > 0 && values[a - 1] === v) a--;
    let b = i;
    while (b < n - 1 && values[b + 1] === v) b++;
    if (i !== a + Math.floor((b - a) / 2)) continue;
    const lower = (x: number) => !(x >= v); // true for lower values, NaN walls and array ends
    if (!lower(a > 0 ? values[a - 1] : NaN) || !lower(b < n - 1 ? values[b + 1] : NaN)) continue;

    let lb = v;
    for (let j = i - 1; j >= 0 && Number.isFinite(values[j]) && values[j] <= v; j--) lb = Math.min(lb, values[j]);
    let rb = v;
    for (let j = i + 1; j < n && Number.isFinite(values[j]) && values[j] <= v; j++) rb = Math.min(rb, values[j]);
    candidates.push({ i, prominence: v - Math.max(lb, rb) });
  }
  // Keep the most prominent peaks first, dropping any that sit too close to a kept one.
  const kept: number[] = [];
  for (const c of candidates.filter((c) => c.prominence >= minProminence).sort((a, b) => b.prominence - a.prominence)) {
    if (kept.every((k) => Math.abs(k - c.i) >= minDistance)) kept.push(c.i);
  }
  return kept.sort((a, b) => a - b);
}

/** Index of the largest (or smallest) finite value in [from, to], or -1. */
export function argExtreme(values: ArrayLike<number>, from: number, to: number, kind: 'max' | 'min'): number {
  let best = -1;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (best < 0 || (kind === 'max' ? v > values[best] : v < values[best])) best = i;
  }
  return best;
}
