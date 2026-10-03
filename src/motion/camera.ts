import type { MotionConfig } from './config';
import { blur121, medianOf, ramp } from './grid';

/** How the whole picture moved since the last frame. */
export interface CameraEstimate {
  /** Picture pixels: the content of the last frame is now this far to the right (dx) and down (dy). */
  dx: number;
  dy: number;
  /** Standard error of the estimate, picture pixels (the larger of the two axes). */
  error: number;
  /** True when there is enough to follow and the estimate is sure enough to be used. */
  ok: boolean;
}

/** The pyramid has at most this many levels, and none whose shorter side is below `MIN_SIDE`: the coarsest finds a move of about 8 pixels. */
const MAX_LEVELS = 4;
const MIN_SIDE = 8;
/** Gauss-Newton steps per level. */
const ITERATIONS = 3;
/** A step is cut to this many pixels of its level: the fit is a first-order one and only holds for small moves. */
const MAX_STEP = 1.5;
/** The last move is tried as a starting guess when it is at least this many pixels. */
const MIN_GUESS = 0.75;
/** Tukey's constant: a pixel whose change is more than this many standard deviations is not background. */
const TUKEY = 4.685;
/** What the median of the absolute values of a normal noise has to be divided by to give its standard deviation. */
const MEDIAN_TO_SIGMA = 1 / 0.6745;
/** A pixel counts as background this much at least, whatever the prior says: the prior only guides, the outlier rejection decides. */
const MIN_PRIOR = 0.15;
/**
 * Gradient energy of a pixel, in squared noise levels of the change between two frames, where it starts to count / counts fully. The
 * gradient of pure noise (after the blur) is about 1.7 of them on average, so it is mostly left out.
 */
const TEXTURE_FROM = 2.5;
const TEXTURE_FULL = 6;

interface Level {
  width: number;
  height: number;
  image: Float32Array;
  /** How much each pixel counts as background (0 to 1). */
  weight: Float32Array;
  gradX: Float32Array;
  gradY: Float32Array;
}

const makeLevel = (width: number, height: number): Level => {
  const n = width * height;
  return {
    width,
    height,
    image: new Float32Array(n),
    weight: new Float32Array(n),
    gradX: new Float32Array(n),
    gradY: new Float32Array(n),
  };
};

/** Halves a picture: every pixel is the mean of a block of 2 × 2 (the last row and column are dropped when the size is odd). */
function halve(src: Float32Array, sw: number, dst: Float32Array, dw: number, dh: number): void {
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = 2 * y * sw + 2 * x;
      dst[y * dw + x] = 0.25 * (src[i] + src[i + 1] + src[i + sw] + src[i + sw + 1]);
    }
  }
}

/**
 * How much the whole picture moved between two frames: one translation, fitted on the background.
 *
 * This is the motion of the camera when the scene is still, and it is what the athlete is measured against: after taking it out, a
 * camera that follows the athlete sees the same thing as one that stands still. The athlete themselves, and anything else that moves
 * on its own, is what the fit has to ignore. Three things do that:
 *
 * - A coarse-to-fine fit (a pyramid of pictures half the size of each other), so that a pan of several pixels a frame is found, and
 *   the fit is a first-order Lucas-Kanade one where it is exact: for moves of a pixel or less.
 * - Tukey's biweight over the pixels: those that do not fit the move of the majority (the athlete) weigh nothing, and the majority
 *   is background as long as the athlete does not fill most of the picture.
 * - A prior: the background is more likely at the edges than in the middle, where the athlete is, and it is not where the detector
 *   found the athlete (`athlete`). It only guides: a floor of `MIN_PRIOR` is left, because a wrong mask must not blind the fit.
 *
 * It knows when it does not know: when the pixels that agree do not pin both axes down (one straight line), or there are too few of them,
 * the error is large and `ok` is false. A plain wall is not that case: with no texture it finds no move, which is no worse than the
 * truth for the detector, since the same wall has no motion to show either.
 */
export class CameraMotion {
  private cur: Level[] = [];
  private prev: Level[] = [];
  private readonly prior: Float32Array;
  private readonly tmp: Float32Array;
  private readonly diff: Float32Array;
  private readonly weight: Float32Array;
  private readonly sample: Float32Array;
  private hasPrev = false;
  private lastDx = 0;
  private lastDy = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly cfg: MotionConfig,
  ) {
    const n = width * height;
    for (let w = width, h = height; this.cur.length < MAX_LEVELS; w >>= 1, h >>= 1) {
      this.cur.push(makeLevel(w, h));
      this.prev.push(makeLevel(w, h));
      if (Math.min(w >> 1, h >> 1) < MIN_SIDE) break;
    }
    this.tmp = new Float32Array(n);
    this.diff = new Float32Array(n);
    this.weight = new Float32Array(n);
    this.sample = new Float32Array(n);
    // The athlete is in the middle of the picture more often than at its edges: a gentle bump of lower weight there.
    this.prior = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (2 * x + 1) / width - 1;
        const ny = (2 * y + 1) / height - 1;
        this.prior[y * width + x] = 1 - 0.85 * Math.exp(-((nx / 0.45) ** 2 + (ny / 0.8) ** 2));
      }
    }
  }

  /** Forgets the last frame: the next one has nothing to be compared with. */
  reset(): void {
    this.hasPrev = false;
    this.lastDx = 0;
    this.lastDy = 0;
  }

  /**
   * Takes the next frame and tells how the picture moved since the last one; null for the first frame. `athlete` is how sure the
   * detector is, per pixel, that this is the athlete (the mask: 1 for the athlete); null when it does not know where the athlete is.
   */
  step(frame: Float32Array, athlete: Float32Array | null): CameraEstimate | null {
    const top = this.cur[0];
    blur121(frame, top.image, top.width, top.height, this.tmp);
    for (let i = 0; i < top.weight.length; i++)
      top.weight[i] = this.prior[i] * (athlete ? MIN_PRIOR + (1 - MIN_PRIOR) * (1 - athlete[i]) : 1);
    for (let l = 1; l < this.cur.length; l++) {
      const from = this.cur[l - 1];
      const to = this.cur[l];
      halve(from.image, from.width, to.image, to.width, to.height);
      halve(from.weight, from.width, to.weight, to.width, to.height);
    }
    for (const level of this.cur) gradients(level);

    if (!this.hasPrev) {
      this.hasPrev = true;
      this.swap();
      return null;
    }

    // The pyramid is climbed down from two starting guesses: no move, and the move of the last frame (a camera that follows an athlete
    // keeps its speed from one frame to the next). The one that leaves the smaller residual is the move.
    let best = this.solve(0, 0);
    if (Math.hypot(this.lastDx, this.lastDy) >= MIN_GUESS) {
      const guessed = this.solve(this.lastDx, this.lastDy);
      if (guessed.sigma < best.sigma) best = guessed;
    }
    const ok = best.error <= this.cfg.cameraMaxError;
    this.lastDx = ok ? best.dx : 0;
    this.lastDy = ok ? best.dy : 0;
    this.swap();
    return { dx: this.lastDx, dy: this.lastDy, error: best.error, ok };
  }

  /** The move from a starting guess: fitted from the coarsest level to the finest, and how well it fits (error, and the residual scale) at the finest. */
  private solve(startX: number, startY: number): { dx: number; dy: number; error: number; sigma: number } {
    let dx = startX;
    let dy = startY;
    for (let l = this.cur.length - 1; l >= 0; l--) {
      const scale = 2 ** l;
      let ux = dx / scale;
      let uy = dy / scale;
      for (let it = 0; it < ITERATIONS; it++) {
        const fit = this.fit(l, ux, uy);
        if (!fit) break;
        ux += clampStep(fit.dx);
        uy += clampStep(fit.dy);
      }
      dx = ux * scale;
      dy = uy * scale;
    }
    const last = this.fit(0, dx, dy);
    return { dx, dy, error: last ? last.error : Infinity, sigma: last ? last.sigma : Infinity };
  }

  private swap(): void {
    [this.cur, this.prev] = [this.prev, this.cur];
  }

  /**
   * One step of the fit at a level, for a move of (ux, uy) pixels of that level: the correction still to make, and the error of the
   * whole fit. Null when there is nothing to fit on (no pixel that has texture and is inside both pictures).
   *
   * The last picture is looked at where the move says the content came from: `I0(x) = prev(x - u)`. What is left, `It = cur - I0`,
   * is explained by the correction `d` as `g . d = -It`, with `g` the gradient. The sums are over the pixels that count: inside both
   * pictures, with texture, background by the prior, and not rejected as outliers.
   */
  private fit(l: number, ux: number, uy: number): { dx: number; dy: number; error: number; sigma: number } | null {
    const cur = this.cur[l];
    const prev = this.prev[l];
    const { width: w, height: h } = cur;
    const n = w * h;
    const { diff, weight, sample } = this;

    // The change at every pixel, without the brightness change of the whole picture (a light that flickers).
    let count = 0;
    let gainSum = 0;
    let gainWeight = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const sx = x - ux;
        const sy = y - uy;
        if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) {
          weight[i] = 0;
          diff[i] = 0;
          continue;
        }
        const x0 = Math.min(w - 2, Math.floor(sx));
        const y0 = Math.min(h - 2, Math.floor(sy));
        const fx = sx - x0;
        const fy = sy - y0;
        const p = y0 * w + x0;
        const i0 =
          (prev.image[p] * (1 - fx) + prev.image[p + 1] * fx) * (1 - fy) +
          (prev.image[p + w] * (1 - fx) + prev.image[p + w + 1] * fx) * fy;
        diff[i] = cur.image[i] - i0;
        weight[i] = cur.weight[i];
        count++;
        gainSum += weight[i] * diff[i];
        gainWeight += weight[i];
      }
    }
    if (count < 16 || gainWeight <= 0) return null;
    const gain = gainSum / gainWeight;
    for (let i = 0; i < n; i++) if (weight[i] > 0) diff[i] -= gain;
    for (let i = 0, k = 0; i < n; i++) if (weight[i] > 0) sample[k++] = Math.abs(diff[i]);
    const sigma = Math.max(this.cfg.noiseFloor, medianOf(sample.subarray(0, count), 0.25, 1024) * MEDIAN_TO_SIGMA);

    // The normal equations of the pixels that count.
    const cut = TUKEY * sigma;
    const floor = TEXTURE_FROM * sigma * sigma;
    const full = TEXTURE_FULL * sigma * sigma;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < n; i++) {
      if (weight[i] <= 0) continue;
      const gx = cur.gradX[i];
      const gy = cur.gradY[i];
      const energy = gx * gx + gy * gy;
      const u = Math.abs(diff[i]) / cut;
      if (u >= 1 || energy <= floor) continue;
      const biweight = (1 - u * u) * (1 - u * u);
      const wt = weight[i] * biweight * ramp(energy, floor, full);
      sxx += wt * gx * gx;
      sxy += wt * gx * gy;
      syy += wt * gy * gy;
      bx -= wt * gx * diff[i];
      by -= wt * gy * diff[i];
    }
    // A little on the diagonal: a set of pixels that is one straight line does not tell the move along it.
    const reg = 1e-3 * (sxx + syy) + 1e-12;
    const a = sxx + reg;
    const c = syy + reg;
    const det = a * c - sxy * sxy;
    if (!(det > 1e-12) || sxx + syy < 1e-9) return null;
    const dx = (c * bx - sxy * by) / det;
    const dy = (a * by - sxy * bx) / det;
    // The error of the move, from the noise of what is left and how much gradient the pixels have along each axis, in pixels of the
    // finest level.
    const error = sigma * Math.sqrt(Math.max(a, c) / det) * 2 ** l;
    return { dx, dy, error, sigma };
  }
}

const clampStep = (d: number): number => (d > MAX_STEP ? MAX_STEP : d < -MAX_STEP ? -MAX_STEP : d);

/** Central differences of a level's picture. */
function gradients(level: Level): void {
  const { width: w, height: h, image, gradX, gradY } = level;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const above = Math.max(0, y - 1) * w;
    const below = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - 1);
      const right = Math.min(w - 1, x + 1);
      gradX[row + x] = (image[row + right] - image[row + left]) * 0.5;
      gradY[row + x] = (image[below + x] - image[above + x]) * 0.5;
    }
  }
}
