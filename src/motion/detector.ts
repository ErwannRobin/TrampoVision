import { mergeMotionConfig, type MotionConfig } from './config';
import { boxFilter, clamp01, dilate, labelPieces, ramp } from './grid';
import { ColumnRhythm } from './rhythm';
import type { GrayFrame, MotionResult } from './types';
import { VerticalFlow } from './verticalFlow';

/** Columns on each side that share their motion when the direction of a column is read, as a share of the picture width: a body is wider than one column. */
const COLUMN_SPREAD_SHARE = 0.016;
/** A column with less vertical motion than this (the share of the picture height that moves at full strength) is damped: a few weak pixels are not a body. */
const DIRECTION_SOFTNESS_SHARE = 0.014;
/** The fastest frame rate and the slowest the detector believes; a frame that comes sooner than the first or later than the second is read as if it did not. */
const MIN_DT_S = 1 / 240;

/**
 * Finds the athlete on a trampoline from the way they move, with no pose model and no training: an athlete who jumps goes up and
 * down through the same columns of the picture, again and again. Nothing else in a gym does that.
 *
 * Every frame goes through four stages:
 * 1. Motion: the vertical motion between this frame and the last one, per pixel (`VerticalFlow`), without what a shaking camera adds
 *    and without what moves sideways (people who walk, a camera that pans).
 * 2. Tracking: every pixel remembers for `holdS` seconds that something moved up through it, and that something moved down.
 *    Motion that went both ways is an oscillation; a one-way move (a person lifting a box) is not.
 * 3. Rhythm: every column keeps the direction of its motion over the last seconds and checks whether it repeats at the pace of a
 *    jump (`ColumnRhythm`). Only the oscillations in a column with that rhythm are evidence of an athlete.
 * 4. Mask: the evidence is kept as a region with hysteresis (it enters high and leaves low), small pieces are dropped, the region
 *    gets a margin and soft edges, and the mask moves toward it quickly where it opens and slowly where it closes, so it does not flicker.
 *
 * It never hides the picture when it is not sure: with no region the mask is all 1, which is the picture as it was. Camera: it has to be
 * still enough that the background stays put; one that follows the athlete or tilts with the jumps makes the whole picture move, and
 * then there is nothing to tell the athlete from.
 */
export class TrampolineMotionDetector {
  private readonly cfg: MotionConfig;
  private width = 0;
  private height = 0;
  private flow: VerticalFlow | null = null;
  private rhythm: ColumnRhythm | null = null;
  private lastTimeMs: number | null = null;
  private fps = 0;
  private found = false;
  private periodS: number | null = null;
  private rhythmFit = 0;
  private noise = 0;

  private motion = new Float32Array(0);
  private up = new Float32Array(0);
  private down = new Float32Array(0);
  private evidence = new Float32Array(0);
  private mask = new Float32Array(0);
  private target = new Float32Array(0);
  private on = new Uint8Array(0);
  private merged = new Uint8Array(0);
  private kept = new Uint8Array(0);
  private grown = new Uint8Array(0);
  private tmpBytes = new Uint8Array(0);
  private tmpFloats = new Float32Array(0);
  private blurred = new Float32Array(0);
  private labels = new Int32Array(0);
  private stack = new Int32Array(0);
  private columnSum = new Float32Array(0);
  private columnAbs = new Float32Array(0);
  private direction = new Float32Array(0);
  private strength = new Float32Array(0);
  private gate = new Float32Array(0);
  private gateWide = new Float32Array(0);

  constructor(config?: Partial<MotionConfig>) {
    this.cfg = mergeMotionConfig(config);
  }

  /** The thresholds in use. */
  get config(): Readonly<MotionConfig> {
    return this.cfg;
  }

  /** Changes thresholds while running (the debug page's sliders). `workWidth` and `rhythmWindowS` apply to the next `reset`. */
  configure(partial: Partial<MotionConfig>): void {
    Object.assign(this.cfg, partial);
  }

  /** Forgets everything learned about the last frames: the next frame starts again, with the picture shown as it is. */
  reset(): void {
    this.flow?.reset();
    this.rhythm?.reset();
    for (const picture of [this.up, this.down, this.evidence, this.motion, this.strength, this.gate, this.gateWide])
      picture.fill(0);
    this.on.fill(0);
    this.mask.fill(1);
    this.lastTimeMs = null;
    this.fps = 0;
    this.found = false;
    this.periodS = null;
    this.rhythmFit = 0;
  }

  /** Takes the next frame of the video (`timeMs` increasing) and tells where the athlete is. */
  push(frame: GrayFrame, timeMs: number): MotionResult {
    if (frame.width !== this.width || frame.height !== this.height) this.allocate(frame.width, frame.height);
    let dt = 0;
    if (this.lastTimeMs !== null) {
      dt = (timeMs - this.lastTimeMs) / 1000;
      // A cut (a seek, a dropped stretch): what was learned about the frames before it says nothing about this one.
      if (dt <= 0 || dt > this.cfg.maxGapS) {
        this.reset();
        dt = 0;
      }
    }
    this.lastTimeMs = timeMs;

    const noise = this.flow!.step(frame.data, this.motion);
    if (noise === null || dt === 0) return this.result();
    dt = Math.max(dt, MIN_DT_S);
    this.noise = noise;
    this.fps = this.fps > 0 ? this.fps + 0.1 * (1 / dt - this.fps) : 1 / dt;

    this.track(dt);
    this.readRhythm(dt);
    this.buildMask(dt);
    return this.result();
  }

  private allocate(width: number, height: number): void {
    const n = width * height;
    this.width = width;
    this.height = height;
    this.flow = new VerticalFlow(width, height, this.cfg);
    this.rhythm = new ColumnRhythm(width, this.cfg);
    this.motion = new Float32Array(n);
    this.up = new Float32Array(n);
    this.down = new Float32Array(n);
    this.evidence = new Float32Array(n);
    this.mask = new Float32Array(n);
    this.target = new Float32Array(n);
    this.on = new Uint8Array(n);
    this.merged = new Uint8Array(n);
    this.kept = new Uint8Array(n);
    this.grown = new Uint8Array(n);
    this.tmpBytes = new Uint8Array(n);
    this.tmpFloats = new Float32Array(n);
    this.blurred = new Float32Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.columnSum = new Float32Array(width);
    this.columnAbs = new Float32Array(width);
    this.direction = new Float32Array(width);
    this.strength = new Float32Array(width);
    this.gate = new Float32Array(width);
    this.gateWide = new Float32Array(width);
    this.reset();
  }

  /** Stage 2: every pixel remembers the strongest move up, and the strongest move down, that went through it lately. */
  private track(dt: number): void {
    const keep = Math.exp(-dt / this.cfg.holdS);
    const { motion, up, down } = this;
    for (let i = 0; i < motion.length; i++) {
      const m = motion[i];
      up[i] = Math.max(up[i] * keep, m < 0 ? -m : 0);
      down[i] = Math.max(down[i] * keep, m > 0 ? m : 0);
    }
  }

  /** Stage 3: the direction of the motion in every column goes into its history; the columns that repeat gate the evidence. */
  private readRhythm(dt: number): void {
    const { width: w, height: h, motion, cfg } = this;
    const spread = Math.max(1, Math.round(COLUMN_SPREAD_SHARE * w));
    const softness = DIRECTION_SOFTNESS_SHARE * h;
    this.columnSum.fill(0);
    this.columnAbs.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const m = motion[y * w + x];
        this.columnSum[x] += m;
        this.columnAbs[x] += Math.abs(m);
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let abs = 0;
      for (let k = Math.max(0, x - spread); k <= Math.min(w - 1, x + spread); k++) {
        sum += this.columnSum[k];
        abs += this.columnAbs[k];
      }
      this.direction[x] = sum / (abs + softness);
    }
    this.rhythm!.push(this.direction);
    const reading = this.rhythm!.read(this.fps);
    this.periodS = reading.periodS;
    this.rhythmFit = reading.fit;
    // A rhythm that comes and goes is noise that happened to line up: the strength of a column is followed, not jumped to.
    const follow = 1 - Math.exp(-dt / cfg.rhythmSmoothS);
    for (let x = 0; x < w; x++) this.strength[x] += (reading.strength[x] - this.strength[x]) * follow;
    for (let x = 0; x < w; x++) this.gate[x] = ramp(this.strength[x], cfg.minRhythm, cfg.fullRhythm);
    // A body is wider than the column that showed its rhythm.
    for (let x = 0; x < w; x++) {
      let best = 0;
      for (let k = Math.max(0, x - spread); k <= Math.min(w - 1, x + spread); k++) best = Math.max(best, this.gate[k]);
      this.gateWide[x] = best;
    }
  }

  /** Stage 4: evidence -> region -> mask. */
  private buildMask(dt: number): void {
    const { width: w, height: h, cfg } = this;
    const n = w * h;
    const short = Math.min(w, h);
    const { up, down, evidence, on } = this;

    // Motion that went up and down in a column with a jump's rhythm; a pixel enters the region high and leaves low.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const e = Math.min(up[i], down[i]) * this.gateWide[x];
        evidence[i] = e;
        on[i] = e >= cfg.enterEvidence || (on[i] === 1 && e >= cfg.stayEvidence) ? 1 : 0;
      }
    }

    // Pieces of the region that are near each other are one athlete; a piece that is too small is not an athlete.
    dilate(on, this.merged, w, h, Math.max(1, Math.round(cfg.mergeShare * short)), this.tmpBytes);
    const areas = labelPieces(this.merged, this.labels, w, h, this.stack);
    const regionArea = areas.map(() => 0);
    for (let i = 0; i < n; i++) if (on[i]) regionArea[this.labels[i]]++;
    // Hysteresis again, on the size: a region that is just big enough must not make the mask come and go.
    const minArea = Math.max(4, cfg.minAreaShare * n) * (this.found ? 0.5 : 1);
    const big = regionArea.map((area, label) => label > 0 && area >= minArea);
    this.found = big.some(Boolean);

    // The mask a frame asks for: the region with its margin and soft edges, or everything when there is no region.
    if (this.found) {
      for (let i = 0; i < n; i++) this.kept[i] = big[this.labels[i]] ? 1 : 0;
      dilate(this.kept, this.grown, w, h, Math.max(1, Math.round(cfg.marginShare * short)), this.tmpBytes);
      for (let i = 0; i < n; i++) this.blurred[i] = this.grown[i];
      // Two passes of a box blur make the edge round instead of a ramp with corners.
      const feather = Math.round(cfg.featherShare * short);
      boxFilter(this.blurred, this.target, w, h, feather, this.tmpFloats, true);
      this.blurred.set(this.target);
      boxFilter(this.blurred, this.target, w, h, feather, this.tmpFloats, true);
    } else {
      this.target.fill(1);
    }

    // The mask follows what is asked quickly where it opens and slowly where it closes.
    const open = 1 - Math.exp(-dt / cfg.openS);
    const close = 1 - Math.exp(-dt / cfg.closeS);
    for (let i = 0; i < n; i++) {
      const wanted = clamp01(this.target[i]);
      this.mask[i] += (wanted - this.mask[i]) * (wanted > this.mask[i] ? open : close);
    }
  }

  private result(): MotionResult {
    let sum = 0;
    for (let i = 0; i < this.mask.length; i++) sum += this.mask[i];
    return {
      width: this.width,
      height: this.height,
      motion: this.motion,
      evidence: this.evidence,
      rhythm: this.strength,
      mask: this.mask,
      found: this.found,
      periodS: this.periodS,
      rhythmFit: this.rhythmFit,
      coverage: this.mask.length > 0 ? sum / this.mask.length : 1,
      noise: this.noise,
      shift: this.flow?.shift ?? 0,
    };
  }
}
