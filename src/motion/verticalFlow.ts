import type { MotionConfig } from './config';
import { blur121, boxFilter, medianOf, ramp } from './grid';

/**
 * What is known about the camera when a frame is compared with the last one:
 * - `shake`: nothing from outside; a vertical shake is looked for in the pictures themselves (a camera on a tripod or in a hand).
 * - `move`: the whole picture moved by this much (`CameraMotion`), and the last frame is shifted by it before the two are compared.
 * - `unknown`: the picture moved and by how much cannot be told: nothing can be said about what moves in it.
 */
export type Compensation = { kind: 'shake' } | { kind: 'move'; dx: number; dy: number } | { kind: 'unknown' };

/** The share of the picture width at each side where the columns that agree on a shake must be found. */
const SHAKE_BORDER = 0.2;

/** The noise level of a picture of absolute changes: the typical change (0.6745 turns the median of the absolute values of a normal noise into its standard deviation). */
const noiseOf = (change: Float32Array, floor: number): number => Math.max(floor, medianOf(change, 0.25, 1024) / 0.6745);

/**
 * Vertical motion between consecutive pictures: Lucas-Kanade over windows the size of a body part.
 *
 * Where a picture moves by (u, v) pixels, what changes at a pixel is `It = -(Ix * u + Iy * v)`. Over a window, the best (u, v) comes
 * from the sums of `Ix²`, `Iy²`, `Ix * Iy`, `Ix * It` and `Iy * It`. It is solved for both axes, for three reasons:
 *
 * - A single slanted edge cannot tell vertical from sideways motion (the aperture problem), and sideways motion leaks into a vertical-only fit.
 *   The sums are signed, so over a window with edges that point several ways (a head, a shoulder, a foot: anything but one long straight
 *   edge) the leaks cancel and the cross term `Ix * Iy` is accounted for. A window that is only one edge is damped by the regularization.
 * - How much of the motion is vertical is read from the solution: a person who walks past has `u` large and `v` small, and a camera that
 *   pans does too. A pixel keeps its vertical motion only where it is most of the motion.
 * - A body that moves much farther than its edge is wide still gets the right sign (the old edge and the new edge vote the same way), and
 *   that is all that is kept: a sign and a strength (`motion`), not a speed.
 *
 * A camera in the hand shakes: every column fits one vertical speed over its whole height; when most columns have something to follow,
 * half of them agree and they reach both sides of the picture, the picture as a whole moved by the middle one, and that shift is taken
 * out of the change first. An athlete is a few columns and is outvoted (even a big one in the middle does not reach both sides); with a
 * plain wall behind them too few columns vote, and nothing is taken out.
 */
export class VerticalFlow {
  private cur: Float32Array;
  private prev: Float32Array;
  private readonly tmp: Float32Array;
  private readonly change: Float32Array;
  private readonly gradX: Float32Array;
  private readonly gradY: Float32Array;
  private readonly delta: Float32Array;
  private readonly product: Float32Array;
  private readonly sumYT: Float32Array;
  private readonly sumXT: Float32Array;
  private readonly sumYY: Float32Array;
  private readonly sumXX: Float32Array;
  private readonly sumXY: Float32Array;
  private readonly warped: Float32Array;
  private readonly outside: Uint8Array;
  private lastNoise = 0;
  private readonly columnSpeeds: number[] = [];
  private readonly columnsAt: number[] = [];
  private hasPrev = false;
  /** The vertical shift of the whole picture taken out of the last frame, picture pixels (for the debug view). */
  shift = 0;
  /**
   * How much every pixel changed since the last frame, in noise levels, once the move of the camera was taken out: what moves in the
   * scene, whichever way. All 0 when there was nothing to compare with or the camera's move could not be told.
   */
  readonly energy: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly cfg: MotionConfig,
  ) {
    const n = width * height;
    const picture = () => new Float32Array(n);
    this.warped = picture();
    this.energy = picture();
    this.outside = new Uint8Array(n);
    this.cur = picture();
    this.prev = picture();
    [
      this.tmp,
      this.change,
      this.gradX,
      this.gradY,
      this.delta,
      this.product,
      this.sumYT,
      this.sumXT,
      this.sumYY,
      this.sumXX,
      this.sumXY,
    ] = Array.from({ length: 11 }, picture);
  }

  /** Forgets the last picture: the next one has nothing to be compared with. */
  reset(): void {
    this.hasPrev = false;
    this.shift = 0;
  }

  /**
   * Takes the next picture and writes the vertical motion since the last one into `motion` (-1 up to 1 down, 0 for nothing).
   * Returns the noise level of the difference, or null for the first picture, where there is nothing to compare with.
   */
  step(frame: Float32Array, motion: Float32Array, camera: Compensation = { kind: 'shake' }): number | null {
    const { width: w, height: h, cfg } = this;
    const n = w * h;
    blur121(frame, this.cur, w, h, this.tmp);
    const { cur, delta } = this;
    let { prev } = this;
    if (!this.hasPrev) {
      this.hasPrev = true;
      motion.fill(0);
      this.energy.fill(0);
      [this.cur, this.prev] = [prev, cur];
      return null;
    }
    if (camera.kind === 'unknown') {
      this.shift = 0;
      motion.fill(0);
      this.energy.fill(0);
      [this.cur, this.prev] = [prev, cur];
      return this.lastNoise;
    }
    // The last picture where the camera says its content went: after it, what moves is what moves in the scene.
    const moved = camera.kind === 'move';
    if (moved) {
      this.warp(prev, camera.dx, camera.dy);
      prev = this.warped;
    }

    // The change between the pictures, without the brightness change of the whole picture (a light that flickers), and the gradients
    // taken half from each picture so the fit sits between the two.
    let gain = 0;
    for (let i = 0; i < n; i++) gain += cur[i] - prev[i];
    gain /= n;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const above = Math.max(0, y - 1) * w;
      const below = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
        const left = Math.max(0, x - 1);
        const right = Math.min(w - 1, x + 1);
        this.gradY[row + x] = (cur[below + x] - cur[above + x] + prev[below + x] - prev[above + x]) * 0.25;
        this.gradX[row + x] = (cur[row + right] - cur[row + left] + prev[row + right] - prev[row + left]) * 0.25;
        delta[row + x] = cur[row + x] - prev[row + x] - gain;
        // Where the last picture had nothing (what came into view): no change, no gradient, nothing to say.
        if (moved && this.outside[row + x]) this.gradY[row + x] = this.gradX[row + x] = delta[row + x] = 0;
      }
    }

    // The shake of the camera, taken out of the change, so the background that shakes is background again and the noise level is not
    // raised by it.
    for (let i = 0; i < n; i++) this.change[i] = Math.abs(delta[i]);
    this.shift = moved ? camera.dy : this.pictureShift(noiseOf(this.change, cfg.noiseFloor));
    if (!moved && this.shift !== 0) for (let i = 0; i < n; i++) delta[i] += this.shift * this.gradY[i];
    for (let i = 0; i < n; i++) this.change[i] = Math.abs(delta[i]);
    const noise = noiseOf(this.change, cfg.noiseFloor);
    this.lastNoise = noise;
    for (let i = 0; i < n; i++) this.energy[i] = this.change[i] / noise;

    // A picture that was moved by the camera's estimate is not exactly where the scene is: the background is left moving a little, as
    // much as the camera did and so as slowly as it does. Motion has to be faster than that.
    const slack = moved ? cfg.cameraSlack * Math.hypot(camera.dx, camera.dy) : 0;
    const minSpeed = cfg.minSpeed + slack;
    const fullSpeed = cfg.fullSpeed + slack;

    // The sums of every window.
    const sum = (a: Float32Array, b: Float32Array, out: Float32Array) => {
      for (let i = 0; i < n; i++) this.product[i] = a[i] * b[i];
      boxFilter(this.product, out, w, h, cfg.flowRadius, this.tmp);
    };
    sum(delta, this.gradY, this.sumYT);
    sum(delta, this.gradX, this.sumXT);
    sum(this.gradY, this.gradY, this.sumYY);
    sum(this.gradX, this.gradX, this.sumXX);
    sum(this.gradX, this.gradY, this.sumXY);

    // The window's own noise: with this much gradient energy and no motion, a window would still show about this much.
    const window = (2 * cfg.flowRadius + 1) ** 2;
    const floor = cfg.minTexture * window * noise * noise;
    for (let i = 0; i < n; i++) {
      const yy = this.sumYY[i];
      const xx = this.sumXX[i];
      const xy = this.sumXY[i];
      if (yy + xx < floor) {
        motion[i] = 0;
        continue;
      }
      // The two speeds, from the 2 x 2 normal equations with a little added to the diagonal: a window that is a single edge has no
      // answer along the edge, and gets none (the added part keeps it from blowing up on noise).
      const reg = floor + cfg.regularization * (yy + xx);
      const a = yy + reg;
      const c = xx + reg;
      const det = a * c - xy * xy;
      const ry = -this.sumYT[i];
      const rx = -this.sumXT[i];
      const v = (c * ry - xy * rx) / det;
      const u = (a * rx - xy * ry) / det;
      // How many noise levels the vertical speed is: its error is noise * sqrt(c / det).
      const significance = Math.abs(v) / (noise * Math.sqrt(c / det));
      const strength =
        ramp(significance, cfg.minSignificance, cfg.fullSignificance) *
        ramp(Math.abs(v), minSpeed, fullSpeed) *
        ramp(Math.abs(v) / (Math.abs(v) + Math.abs(u) + 1e-6), cfg.minDominance, cfg.fullDominance);
      motion[i] = v < 0 ? -strength : strength;
    }
    [this.cur, this.prev] = [this.prev, cur];
    return noise;
  }

  /** `src` moved by (dx, dy) pixels into `this.warped` (linear between pixels); `this.outside` marks where `src` had nothing to give. */
  private warp(src: Float32Array, dx: number, dy: number): void {
    const { width: w, height: h, warped, outside } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        const sy = y - dy;
        const i = y * w + x;
        outside[i] = sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1 ? 1 : 0;
        const cx = Math.min(w - 1, Math.max(0, sx));
        const cy = Math.min(h - 1, Math.max(0, sy));
        const x0 = Math.min(w - 2, Math.floor(cx));
        const y0 = Math.min(h - 2, Math.floor(cy));
        const fx = cx - x0;
        const fy = cy - y0;
        const p = y0 * w + x0;
        warped[i] =
          (src[p] * (1 - fx) + src[p + 1] * fx) * (1 - fy) + (src[p + w] * (1 - fx) + src[p + w + 1] * fx) * fy;
      }
    }
  }

  /**
   * How far the whole picture moved down since the last one, picture pixels; 0 when it cannot be told. Every column fits its own
   * vertical speed over its whole height. The picture moved when enough columns have texture to follow and half of them agree.
   */
  private pictureShift(noise: number): number {
    const { width: w, height: h, cfg } = this;
    const minEnergy = cfg.minTexture * h * noise * noise;
    const speeds = this.columnSpeeds;
    const columns = this.columnsAt;
    speeds.length = 0;
    columns.length = 0;
    for (let x = 0; x < w; x++) {
      let cross = 0;
      let energy = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        cross += this.delta[i] * this.gradY[i];
        energy += this.gradY[i] * this.gradY[i];
      }
      if (energy >= minEnergy) {
        speeds.push(-cross / energy);
        columns.push(x);
      }
    }
    if (speeds.length < cfg.minShakeColumns * w) return 0;
    const sorted = [...speeds].sort((a, b) => a - b);
    const middle = sorted[sorted.length >> 1];
    let agree = 0;
    let left = false;
    let right = false;
    speeds.forEach((s, k) => {
      if (Math.abs(s - middle) > cfg.shakeSpread) return;
      agree++;
      left ||= columns[k] < SHAKE_BORDER * w;
      right ||= columns[k] >= (1 - SHAKE_BORDER) * w;
    });
    // The whole picture moves together: half of the columns that can tell agree, and they reach both sides of it (a big athlete in the
    // middle is not a shake).
    return agree * 2 >= speeds.length && left && right ? middle : 0;
  }
}
