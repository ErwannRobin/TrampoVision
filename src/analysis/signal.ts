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
 * Linear interpolation over NaN gaps of at most `maxGap` samples that have a valid sample on
 * both sides. Longer gaps (and leading/trailing gaps) stay NaN so we never invent long stretches.
 */
export function fillGaps(values: ArrayLike<number>, maxGap: number): Float64Array {
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
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (gap + 1);
    }
    i = j;
  }
  return out;
}

/** Solves A c = b in place (Gaussian elimination, partial pivoting). A is m x m row-major. */
function solve(A: number[], b: number[], m: number): number[] | null {
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
 * Every contiguous run of finite samples is processed independently.
 */
export function localPolyFit(values: ArrayLike<number>, window: number, order = 2): LocalFit {
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
    fitRun(values, start, end, window, order, value, slope);
    start = end;
  }
  return { value, slope };
}

function fitRun(
  y: ArrayLike<number>,
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
      const pw = new Array<number>(2 * m - 1);
      pw[0] = 1;
      for (let k = 1; k < pw.length; k++) pw[k] = pw[k - 1] * u;
      for (let r = 0; r < m; r++) {
        b[r] += pw[r] * yj;
        for (let c = 0; c < m; c++) A[r * m + c] += pw[r + c];
      }
    }
    const c = solve(A, b, m);
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

/**
 * Makes a wrapped-angle series continuous (cumulative rotation). Continues through NaN gaps
 * using the shortest angular step from the last valid sample.
 */
export function unwrapDegrees(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  let prevRaw = NaN;
  let prevOut = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    out[i] = Number.isFinite(prevRaw) ? prevOut + wrapDegrees(v - prevRaw) : v;
    prevRaw = v;
    prevOut = out[i];
  }
  return out;
}
