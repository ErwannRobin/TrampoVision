import { CameraMotion, type CameraEstimate } from './camera';
import { CAMERA_PROFILES, CameraTypeEstimator } from './cameraType';
import { mergeMotionConfig, type CameraType, type MotionConfig } from './config';
import { boxFilter, clamp01, dilate, labelPieces, ramp, shiftPicture, wholePixels } from './grid';
import { ColumnRhythm } from './rhythm';
import type { GrayFrame, MotionResult } from './types';
import { VerticalFlow, type Compensation } from './verticalFlow';

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
 * It never hides the picture when it is not sure: with no region the mask is all 1, which is the picture as it was.
 *
 * Camera: the whole picture is measured first (`CameraMotion`: one translation, fitted on the background), and the kind of shot is read from it
 * (`CameraTypeEstimator`), because each kind needs the picture prepared in another way:
 * - `fixed`, a wide shot on a tripod or in a hand: the shake of the picture is taken out of the motion (the whole move, found on the
 *   background; the vertical shake the columns agree on when that cannot be told).
 * - `lowAngle`, a still camera at the bed looking up, the athlete big in the picture: the same, with the athlete excluded from the fit
 *   by where the detector found them, and a bigger piece of motion needed to count as an athlete.
 * - `tracking`, a camera that follows the athlete or pans: the move is taken out, and everything the detector remembers (what went up and
 *   down through a pixel, the rhythm of the columns, the mask) moves with the picture, so it stays on the same place of the scene. What
 *   is left to see is the athlete against a background that stands still, as in a fixed shot. When the move cannot be told (a plain
 *   wall) nothing is said about the frame, and the mask opens by itself as what was remembered fades.
 */
export class TrampolineMotionDetector {
  /** What the person set, and what is in use: the same plus what the kind of shot changes (`CAMERA_PROFILES`). The parts of the detector share the second. */
  private readonly user: MotionConfig;
  private readonly cfg: MotionConfig;
  private width = 0;
  private height = 0;
  private flow: VerticalFlow | null = null;
  private rhythm: ColumnRhythm | null = null;
  private camera: CameraMotion | null = null;
  private readonly typeEstimator: CameraTypeEstimator;
  private cameraType: CameraType = 'fixed';
  private estimate: CameraEstimate | null = null;
  /** The move of the picture that is not yet a whole pixel, kept for the next frames (what the detector remembers moves by whole pixels). */
  private readonly panX = { value: 0 };
  private readonly panY = { value: 0 };
  private athleteWidth: number | null = null;
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
    this.user = mergeMotionConfig(config);
    this.cfg = { ...this.user };
    this.typeEstimator = new CameraTypeEstimator(this.cfg);
  }

  /** The thresholds as they were set. */
  get config(): Readonly<MotionConfig> {
    return this.user;
  }

  /** Changes thresholds while running (the debug page's sliders). `workWidth` and `rhythmWindowS` apply to the next `reset`. */
  configure(partial: Partial<MotionConfig>): void {
    Object.assign(this.user, partial);
    this.useProfile();
  }

  /** What the detector believes the shot is: the person's choice, or what the video says. */
  private wantedType(): CameraType {
    return this.user.cameraType === 'auto' ? this.typeEstimator.type : this.user.cameraType;
  }

  /** The thresholds in use: the person's, and the changes of the kind of shot. */
  private useProfile(): void {
    Object.assign(this.cfg, this.user, CAMERA_PROFILES[this.cameraType]);
  }

  /** Forgets everything learned about the last frames: the next frame starts again, with the picture shown as it is. */
  reset(): void {
    this.flow?.reset();
    this.camera?.reset();
    this.typeEstimator.reset();
    this.cameraType = 'fixed';
    this.estimate = null;
    this.athleteWidth = null;
    this.forget();
    this.mask.fill(1);
    this.lastTimeMs = null;
    this.fps = 0;
    this.useProfile();
  }

  /** Forgets what was learned about where things went up and down: it was learned in another kind of shot, or another place. */
  private forget(): void {
    this.rhythm?.reset();
    for (const picture of [this.up, this.down, this.evidence, this.motion, this.strength, this.gate, this.gateWide])
      picture.fill(0);
    this.on.fill(0);
    this.panX.value = this.panY.value = 0;
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

    const compensation = dt > 0 ? this.readCamera(frame, dt) : this.firstCamera(frame);
    const noise = this.flow!.step(frame.data, this.motion, compensation);
    if (noise === null || dt === 0) return this.result();
    dt = Math.max(dt, MIN_DT_S);
    this.noise = noise;
    this.fps = this.fps > 0 ? this.fps + 0.1 * (1 / dt - this.fps) : 1 / dt;

    this.track(dt);
    this.readRhythm(dt);
    this.buildMask(dt);
    return this.result();
  }

  /** The first frame has nothing to be compared with: the camera takes it in. */
  private firstCamera(frame: GrayFrame): Compensation {
    this.camera!.step(frame.data, null);
    this.applyType();
    return { kind: 'shake' };
  }

  /** Switches to the kind of shot the detector believes in now, and returns it. */
  private applyType(): CameraType {
    const type = this.wantedType();
    if (type !== this.cameraType) {
      // What was learned before the camera was known to follow was learned from a background that moved, and is dropped. Leaving
      // `tracking` keeps it: the memory is in the place of the picture as it is now, which is where a still camera looks.
      if (type === 'tracking') this.forget();
      this.cameraType = type;
      this.useProfile();
    }
    return type;
  }

  /**
   * How the picture moved since the last frame, what kind of shot that makes it, and what to do about it: for `tracking` what the
   * detector remembers moves with the picture. Returns how the motion between the two frames is to be read.
   */
  private readCamera(frame: GrayFrame, dt: number): Compensation {
    const estimate = this.camera!.step(frame.data, this.found ? this.mask : null);
    this.estimate = estimate;
    if (estimate) {
      this.typeEstimator.push(
        {
          dt: Math.max(dt, MIN_DT_S),
          dx: estimate.dx,
          dy: estimate.dy,
          athleteWidthShare: this.found ? this.athleteWidth : null,
        },
        Math.min(this.width, this.height),
      );
    }
    const type = this.applyType();
    if (!estimate) return { kind: 'shake' };
    if (!estimate.ok) return type === 'tracking' ? { kind: 'unknown' } : { kind: 'shake' };
    if (type === 'tracking') this.moveMemory(estimate.dx, estimate.dy);
    return { kind: 'move', dx: estimate.dx, dy: estimate.dy };
  }

  /** The picture moved by (dx, dy): what is remembered of the scene moves with it, so that it stays on the same place of the scene. */
  private moveMemory(dx: number, dy: number): void {
    const sx = wholePixels(this.panX, dx);
    const sy = wholePixels(this.panY, dy);
    if (sx === 0 && sy === 0) return;
    const { width: w, height: h } = this;
    for (const picture of [this.up, this.down, this.mask]) {
      shiftPicture(picture, this.tmpFloats, w, h, sx, sy, picture === this.mask ? null : 0);
      picture.set(this.tmpFloats);
    }
    shiftPicture(this.on, this.tmpBytes, w, h, sx, sy, 0);
    this.on.set(this.tmpBytes);
    this.rhythm!.shift(sx);
    for (const column of [this.strength, this.gate, this.gateWide]) {
      const keep = column.slice();
      column.fill(0);
      for (let x = 0; x < w; x++) if (x - sx >= 0 && x - sx < w) column[x] = keep[x - sx];
    }
  }

  private allocate(width: number, height: number): void {
    const n = width * height;
    this.width = width;
    this.height = height;
    this.flow = new VerticalFlow(width, height, this.cfg);
    this.rhythm = new ColumnRhythm(width, this.cfg);
    this.camera = new CameraMotion(width, height, this.cfg);
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
    const pieces = this.measurePieces(areas.length);
    // Hysteresis again, on the size: a region that is just big enough must not make the mask come and go.
    const minArea = Math.max(4, cfg.minAreaShare * n) * (this.found ? 0.5 : 1);
    const big = pieces.area.map((area, label) => label > 0 && area >= minArea);
    this.found = big.some(Boolean);
    this.athleteWidth = this.found
      ? Math.max(0, ...big.map((isBig, label) => (isBig ? pieces.width[label] : 0))) / w
      : null;

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

  /** The area and width of every piece of the region (labels of `merged`), counting the pixels with evidence and not their margin. */
  private measurePieces(count: number): { area: number[]; width: number[] } {
    const { width: w, height: h, labels, on } = this;
    const area = new Array<number>(count).fill(0);
    const left = new Array<number>(count).fill(w);
    const right = new Array<number>(count).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!on[i]) continue;
        const label = labels[i];
        area[label]++;
        if (x < left[label]) left[label] = x;
        if (x > right[label]) right[label] = x;
      }
    }
    return {
      area,
      width: right.map((r, label) => Math.max(0, r - left[label] + 1)),
    };
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
      camera: {
        type: this.cameraType,
        dx: this.estimate?.dx ?? 0,
        dy: this.estimate?.dy ?? 0,
        known: this.estimate?.ok ?? false,
        speed: this.typeEstimator.speed,
      },
    };
  }
}
