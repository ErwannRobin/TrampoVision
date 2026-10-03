/** Small helpers for the pictures of the motion detector: float or byte pictures stored row by row. */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0 below `lo`, 1 above `hi`, a straight line between. */
export const ramp = (v: number, lo: number, hi: number): number =>
  hi > lo ? clamp01((v - lo) / (hi - lo)) : v >= hi ? 1 : 0;

/**
 * Sum (or mean) over every window of (2r + 1)² pixels. The picture is extended by its edge pixels, so the sum of a window
 * at the border counts the edge row again instead of shrinking. `tmp` is a picture of the same size.
 */
export function boxFilter(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  tmp: Float32Array,
  mean = false,
): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const scale = mean ? 1 / ((2 * r + 1) * (2 * r + 1)) : 1;
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * scale;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/** Grows the set pixels of a 0/1 picture by `r` pixels in every direction (a square window). `tmp` is a picture of the same size. */
export function dilate(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, tmp: Uint8Array): void {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r) && !on; i++) on = src[row + i];
      tmp[row + x] = on;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 0;
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r) && !on; j++) on = tmp[j * w + x];
      dst[y * w + x] = on;
    }
  }
}

/**
 * Splits a 0/1 picture into pieces of touching pixels (up and down, left and right). Fills `labels` with the piece number
 * of every set pixel (1, 2, ...; 0 elsewhere) and returns the area of every piece, index 0 unused. `stack` holds `w * h` ints.
 */
export function labelPieces(binary: Uint8Array, labels: Int32Array, w: number, h: number, stack: Int32Array): number[] {
  labels.fill(0);
  const areas = [0];
  for (let start = 0; start < w * h; start++) {
    if (!binary[start] || labels[start]) continue;
    const label = areas.length;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (binary[q] && !labels[q]) {
          labels[q] = label;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    areas.push(area);
  }
  return areas;
}

/** The middle value of a picture of non-negative numbers below `max`, from a histogram: exact to `max / bins`. */
export function medianOf(values: Float32Array, max: number, bins = 512): number {
  const counts = new Uint32Array(bins);
  const scale = (bins - 1) / max;
  for (let i = 0; i < values.length; i++) counts[Math.min(bins - 1, Math.floor(values[i] * scale))]++;
  let seen = 0;
  const half = values.length / 2;
  for (let b = 0; b < bins; b++) {
    seen += counts[b];
    if (seen >= half) return (b + 0.5) / scale;
  }
  return max;
}

/** Blur kernel [1 2 1] / 4 in both directions: widens the edges so the flow can follow a moving body that is not slow. */
export function blur121(src: Float32Array, dst: Float32Array, w: number, h: number, tmp: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      tmp[row + x] =
        0.25 * src[row + Math.max(0, x - 1)] + 0.5 * src[row + x] + 0.25 * src[row + Math.min(w - 1, x + 1)];
    }
  }
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) dst[y * w + x] = 0.25 * tmp[up + x] + 0.5 * tmp[y * w + x] + 0.25 * tmp[down + x];
  }
}

/**
 * Moves a picture by whole pixels: `dst` at (x, y) is `src` at (x - sx, y - sy). Where that is outside `src`, `dst` is `fill`, or the nearest
 * pixel of `src` when `fill` is null (the picture goes on past its edge, as a vertical stripe does). `src` and `dst` must be different pictures.
 */
export function shiftPicture<T extends Float32Array | Uint8Array>(
  src: T,
  dst: T,
  w: number,
  h: number,
  sx: number,
  sy: number,
  fill: number | null,
): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let from = y - sy;
    if (from < 0 || from >= h) {
      if (fill !== null) {
        dst.fill(fill, row, row + w);
        continue;
      }
      from = from < 0 ? 0 : h - 1;
    }
    const x0 = Math.max(0, sx);
    const x1 = Math.min(w, w + sx);
    if (x1 <= x0) {
      if (fill !== null) dst.fill(fill, row, row + w);
      else dst.fill(src[from * w + (sx > 0 ? 0 : w - 1)], row, row + w);
      continue;
    }
    if (x0 > 0) dst.fill(fill ?? src[from * w], row, row + x0);
    if (x1 < w) dst.fill(fill ?? src[from * w + w - 1], row + x1, row + w);
    dst.set(src.subarray(from * w + x0 - sx, from * w + x1 - sx), row + x0);
  }
}

/** Takes the whole pixels out of a move that is kept as a fraction: returns them and leaves the rest in `remainder.value`. */
export function wholePixels(remainder: { value: number }, move: number): number {
  const total = remainder.value + move;
  const whole = Math.round(total);
  remainder.value = total - whole;
  return whole || 0;
}
