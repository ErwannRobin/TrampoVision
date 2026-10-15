import { CameraMotion, type CameraEstimate } from './camera';
import { CAMERA_PROFILES, CameraTypeEstimator } from './cameraType';
import { mergeMotionConfig, type CameraType, type MotionConfig } from './config';
import { clamp01, dilate, labelPieces, ramp, shiftPicture, wholePixels } from './grid';
import { ColumnRhythm } from './rhythm';
import type { Box, GrayFrame, MotionResult } from './types';
import { VerticalFlow, type Compensation } from './verticalFlow';

/** Columns on each side that share their motion when the direction of a column is read, as a share of the picture width: a body is wider than one column. */
const COLUMN_SPREAD_SHARE = 0.016;
/** A column with less vertical motion than this (the share of the picture height that moves at full strength) is damped: a few weak pixels are not a body. */
const DIRECTION_SOFTNESS_SHARE = 0.014;
/** The fastest frame rate and the slowest the detector believes; a frame that comes sooner than the first or later than the second is read as if it did not. */
const MIN_DT_S = 1 / 240;
/** A region is the one that was followed when this share of the smaller of the two boxes lies inside the other. */
const FOLLOWED_OVERLAP = 0.3;

/** What `buildMask` knows about every piece of the region where things went up and down (the labels of `merged`; index 0 is not a piece). */
interface Pieces {
  /** Pixels with evidence. */
  area: number[];
  /** The evidence of those pixels added up: how strongly the piece goes up and down, and how much of it. */
  mass: number[];
  /** The box of the piece, with the pixels that were added to join it. */
  box: Box[];
  /** The width of the pixels with evidence. */
  width: number[];
}

const boxArea = (b: Box): number => Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1);

/** The box `by` pixels bigger on every side, kept inside a picture of w × h pixels. */
const growBox = (b: Box, by: number, w: number, h: number): Box => ({
  x0: Math.max(0, b.x0 - by),
  y0: Math.max(0, b.y0 - by),
  x1: Math.min(w - 1, b.x1 + by),
  y1: Math.min(h - 1, b.y1 + by),
});

/**
 * Where the athlete of a region can be: its columns, from its bottom up to the top of the picture. The region is where things went up and
 * down, so the top of a jump higher than the ones it was learnt from is not in it yet. On the wide tripod sample the detector found the
 * athlete during low bounces (the region was rows 41 to 70 of 72), and the next jump went up to row 10: the box, looked for in the region
 * only, stayed on the bed, and the mask hid the athlete for most of a second. Little else moves above the athlete in the jump's columns.
 */
const reachOf = (window: Box): Box => ({ ...window, y0: 0 });
/**
 * Whether a skeleton the pose model saw is the athlete of a region: its middle is in the region's columns, at or above its bottom. Not any
 * overlap (a stranger whose arm reaches the columns is not the athlete), nor most of the skeleton inside (arms held out wide are outside).
 */
function inReach(body: Box, window: Box): boolean {
  const reach = reachOf(window);
  const cx = (body.x0 + body.x1) / 2;
  const cy = (body.y0 + body.y1) / 2;
  return cx >= reach.x0 && cx <= reach.x1 + 1 && cy <= reach.y1 + 1;
}

/** How much of the smaller of two boxes lies inside the other, 0 to 1. */
function overlapShare(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(boxArea(a), boxArea(b)));
}

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
 * 4. The athlete and the mask: the evidence is kept as regions with hysteresis (it enters high and leaves low) and small pieces are
 *    dropped. Of the rest only the strongest is the athlete (`maxAthletes`: the video is of one person who jumps, and the others, the
 *    coach, the people who wait, are not): the region that was followed keeps its place unless another is clearly stronger. The region is the
 *    place the athlete jumps through; the athlete is the box of what moves in it, or above it in its columns (a jump higher than the ones it
 *    was learnt from), right now, less the bed, which moves with the jumps too but is a flat bar and not a body (`boxIn`). That box, with a
 *    margin and soft edges, is what the mask keeps, with the skeleton the pose model saw in the frame before when it is told it
 *    (`seeBodies`), so a person who stands still in the place the athlete jumps through, or next to them, is hidden too.
 *
 * It never hides the picture when it is not sure: with no athlete the mask is all 1, which is the picture as it was, and the background
 * fades in and out (`fadeInS`, `fadeOutS`) instead of cutting.
 *
 * Camera: the whole picture is measured first (`CameraMotion`: one translation, fitted on the background), and the kind of shot is read from it
 * (`CameraTypeEstimator`), because each kind needs the picture prepared in another way:
 * - `fixed`, a wide shot on a tripod or in a hand: the shake of the picture is taken out of the motion (the whole move, found on the
 *   background; the vertical shake the columns agree on when that cannot be told).
 * - `lowAngle`, a still camera at the bed looking up, the athlete big in the picture: the same, with the athlete excluded from the fit
 *   by where the detector found them, and a bigger piece of motion needed to count as an athlete.
 * - `tracking`, a camera that follows the athlete or pans: the move is taken out, and a move has to be faster than the camera's own
 *   error to count. What is left to see is the athlete against a background that stands still, as in a fixed shot. When the move cannot
 *   be told (a plain wall) nothing is said about the frame, and the mask opens by itself as what was remembered fades.
 *
 * In every kind of shot, everything the detector remembers (what went up and down through a pixel, the rhythm of the columns, the mask)
 * moves with the picture by the move that was measured, so it stays on the same place of the scene; with a camera that stands still that
 * move adds up to nothing. So a change of the kind of shot drops nothing.
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

  /** The place of each athlete that is followed (the box of the region they jump in, and a little more): to know the same one next frame. */
  private windows: Box[] = [];
  /** The athletes, as boxes: what moves in the window now, or the window itself when nothing does. */
  private athletes: Box[] = [];
  /** How far the background is hidden, 0 (the picture as it is) to 1 (hidden wherever the athlete is not). */
  private fade = 0;
  /** Where the athlete is known to jump from a first look at the clip (`hint`): kept in the picture until the detector finds them by itself. */
  private hinted: Box | null = null;
  /** The athletes' bodies as the pose model saw them in the last frame (`seeBodies`): the next mask keeps them too, once. */
  private bodies: Box[] = [];
  /** The ones of those the last mask kept. */
  private keptBodies: Box[] = [];

  private motion = new Float32Array(0);
  private up = new Float32Array(0);
  private down = new Float32Array(0);
  private evidence = new Float32Array(0);
  private mask = new Float32Array(0);
  /** Where the picture stays when the background is fully hidden: 1 around the athletes, 0 elsewhere. */
  private target = new Float32Array(0);
  /** 1 for a pixel that moved in the jump's columns less than `activeHoldS` ago, falling to 0. */
  private held = new Float32Array(0);
  private on = new Uint8Array(0);
  private merged = new Uint8Array(0);
  private moving = new Uint8Array(0);
  private joined = new Uint8Array(0);
  private tmpBytes = new Uint8Array(0);
  private tmpFloats = new Float32Array(0);
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

  /**
   * Tells the detector where the athlete will be found, from a first run over the same clip (a look ahead that a live video does not have):
   * until it finds them itself, in the first seconds, everything else is hidden from the first frame, with no wait for the rhythm. The hint is
   * forgotten when the detector finds the athlete, or when the video is cut. Null takes it back.
   */
  hint(box: Box | null): void {
    this.hinted = box ? { ...box } : null;
  }

  /**
   * Tells the detector where the pose model found the athletes in the frame it was just given: the box around each one's skeleton, picture
   * pixels. The next mask keeps those boxes too, with the same margin as the box of what moves, so that a body is not cut where it does not
   * move enough to be seen moving: legs that hold still in a pike, or are as pale as the bed, a body at the top of a jump, where only the bed
   * still moves. A box whose middle is in none of the places the athletes can be (`inReach`) is left out: it is somebody else. The boxes are used
   * once: a frame in which the pose model finds nobody keeps only what moves.
   *
   * Measured on the samples, with the skeleton of the frame before standing in for the pose model's (and the box looked for above the region,
   * `reachOf`): frames in which the mask hid part of the athlete's body, before → after — wide tripod 15.2 → 1.6% (the whole athlete 2.7 →
   * 0.5%; checked against RTMPose run on the clip without a mask), phone close-up 22.1 → 3.6%, synchro 11.4 → 0.5%, the still start of the
   * broadcast 57.9 → 0% — for a picture kept 0.2 to 3.5 points bigger.
   */
  seeBodies(boxes: readonly Box[]): void {
    this.bodies = boxes.map((b) => ({
      x0: Math.floor(b.x0),
      y0: Math.floor(b.y0),
      x1: Math.ceil(b.x1),
      y1: Math.ceil(b.y1),
    }));
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
    this.target.fill(0);
    this.fade = 0;
    this.lastTimeMs = null;
    this.fps = 0;
    this.useProfile();
  }

  /** Forgets what was learned about where things went up and down: it was learned in another kind of shot, or another place. */
  private forget(): void {
    this.rhythm?.reset();
    for (const picture of [
      this.up,
      this.down,
      this.held,
      this.evidence,
      this.motion,
      this.strength,
      this.gate,
      this.gateWide,
    ])
      picture.fill(0);
    this.on.fill(0);
    this.panX.value = this.panY.value = 0;
    this.windows = [];
    this.athletes = [];
    this.bodies = [];
    this.keptBodies = [];
    this.athleteWidth = null;
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
        this.hinted = null;
        dt = 0;
      }
    }
    this.lastTimeMs = timeMs;

    const compensation = dt > 0 ? this.readCamera(frame, dt) : this.firstCamera(frame);
    const noise = this.flow!.step(frame.data, this.motion, compensation);
    if (noise === null || dt === 0) {
      if (this.hinted) this.applyHint();
      return this.result();
    }
    dt = Math.max(dt, MIN_DT_S);
    this.noise = noise;
    this.fps = this.fps > 0 ? this.fps + 0.1 * (1 / dt - this.fps) : 1 / dt;

    this.track(dt);
    this.readRhythm(dt);
    this.trackMoving(dt);
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
      // Nothing is forgotten at the change: what the detector remembers has moved with the picture all along, whatever the kind of shot,
      // so it is in the right place of the scene either way. (It used to be dropped on entering `tracking`, and a camera in a hand, whose
      // speed sits around the threshold, lost the athlete for seconds at every change.)
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
    // The picture the athlete keeps (the box and its margin) is what the fit leaves out: not the faded mask, which is 1 everywhere while the background fades in.
    const estimate = this.camera!.step(frame.data, this.found ? this.target : null);
    this.estimate = estimate;
    if (estimate) {
      this.typeEstimator.push(
        {
          dt: Math.max(dt, MIN_DT_S),
          dx: estimate.dx,
          dy: estimate.dy,
          known: estimate.ok,
          athleteWidthShare: this.found ? this.athleteWidth : null,
        },
        Math.min(this.width, this.height),
      );
    }
    const type = this.applyType();
    if (!estimate) return { kind: 'shake' };
    if (!estimate.ok) return type === 'tracking' ? { kind: 'unknown' } : { kind: 'shake' };
    // Whatever the kind of shot: with a camera that stands still the move adds up to nothing, and the memory stays where it is.
    this.moveMemory(estimate.dx, estimate.dy);
    return { kind: 'move', dx: estimate.dx, dy: estimate.dy };
  }

  /** The picture moved by (dx, dy): what is remembered of the scene moves with it, so that it stays on the same place of the scene. */
  private moveMemory(dx: number, dy: number): void {
    const sx = wholePixels(this.panX, dx);
    const sy = wholePixels(this.panY, dy);
    if (sx === 0 && sy === 0) return;
    const { width: w, height: h } = this;
    for (const picture of [this.up, this.down, this.held]) {
      shiftPicture(picture, this.tmpFloats, w, h, sx, sy, 0);
      picture.set(this.tmpFloats);
    }
    const move = (b: Box): Box => ({ x0: b.x0 + sx, y0: b.y0 + sy, x1: b.x1 + sx, y1: b.y1 + sy });
    this.windows = this.windows.map(move);
    this.bodies = this.bodies.map(move);
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
    this.held = new Float32Array(n);
    this.on = new Uint8Array(n);
    this.merged = new Uint8Array(n);
    this.moving = new Uint8Array(n);
    this.joined = new Uint8Array(n);
    this.tmpBytes = new Uint8Array(n);
    this.tmpFloats = new Float32Array(n);
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

  /** The pixels that moved lately, in the jump's columns: what an athlete is made of right now, which a region of places they went through is not. */
  private trackMoving(dt: number): void {
    const { width: w, height: h, cfg, held, gateWide } = this;
    const energy = this.flow!.energy;
    const fall = dt / cfg.activeHoldS;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        held[i] = energy[i] >= cfg.activeLevel && gateWide[x] > 0 ? 1 : Math.max(0, held[i] - fall);
      }
    }
  }

  /** Stage 4: evidence -> regions -> the athlete -> the box around them -> mask. */
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

    // Pieces of the region that are near each other are one region; a piece that is too small is not an athlete.
    dilate(on, this.merged, w, h, Math.max(1, Math.round(cfg.mergeShare * short)), this.tmpBytes);
    const areas = labelPieces(this.merged, this.labels, w, h, this.stack);
    const pieces = this.measurePieces(areas.length);
    // Hysteresis again, on the size: a region that is just big enough must not make the mask come and go.
    const minArea = Math.max(4, cfg.minAreaShare * n) * (this.found ? 0.5 : 1);
    const big = pieces.area.map((area, label) => label > 0 && area >= minArea);
    this.found = big.some(Boolean);

    // The athlete: the one region with the strongest up and down motion, and the box of what moves in it.
    const pad = Math.max(1, Math.round(cfg.marginShare * short));
    const chosen = this.found ? this.chooseAthletes(pieces, big) : [];
    this.windows = chosen.map((label) => growBox(pieces.box[label], pad, w, h));
    const before = this.athletes;
    this.athletes = this.windows.map((window) =>
      this.boxIn(window, before.find((b) => overlapShare(b, reachOf(window)) > 0) ?? null),
    );
    // Against the shorter side, like every size of the detector: the same athlete is as big in a portrait video as in a landscape one.
    this.athleteWidth = this.athletes.length ? Math.max(...this.athletes.map((b) => b.x1 - b.x0 + 1)) / short : null;

    // The picture the athletes keep, and how far the rest is hidden: the background goes away over `fadeInS` and comes back over `fadeOutS`.
    this.keptBodies = this.found
      ? this.bodies.filter((body) => this.windows.some((window) => inReach(body, window)))
      : [];
    this.bodies = [];
    if (this.found) {
      this.hinted = null;
      this.target.fill(0);
      for (const box of [...this.athletes, ...this.keptBodies]) this.paintBox(box, pad);
    } else if (this.hinted) {
      this.applyHint();
    }
    if (!this.hinted) {
      const step = dt / (this.found ? cfg.fadeInS : cfg.fadeOutS);
      this.fade = clamp01(this.fade + (this.found ? step : -step));
    }
    for (let i = 0; i < n; i++) this.mask[i] = 1 - this.fade * (1 - this.target[i]);
  }

  /** Not sure yet, but told where: the picture is kept there and hidden elsewhere, at once (the first frames of a clip that was looked at ahead). */
  private applyHint(): void {
    const { width: w, height: h, cfg } = this;
    this.target.fill(0);
    this.paintBox(this.hinted!, Math.max(1, Math.round(cfg.marginShare * Math.min(w, h))));
    this.athletes = [{ ...this.hinted! }];
    this.fade = 1;
    for (let i = 0; i < w * h; i++) this.mask[i] = this.target[i];
  }

  /**
   * The regions to keep: the strongest, and with `maxAthletes` above 1 the next ones that are at least `otherAthleteShare` as strong. A
   * region that comes where the one followed was is counted `switchRatio` times stronger than it is, so that two regions of about the same
   * strength do not take turns.
   */
  private chooseAthletes(pieces: Pieces, big: boolean[]): number[] {
    const { cfg } = this;
    const ranked: { label: number; score: number }[] = [];
    big.forEach((isBig, label) => {
      if (!isBig) return;
      const followed = this.windows.some((window) => overlapShare(window, pieces.box[label]) >= FOLLOWED_OVERLAP);
      ranked.push({ label, score: pieces.mass[label] * (followed ? cfg.switchRatio : 1) });
    });
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked.length ? ranked[0].score : 0;
    return ranked
      .slice(0, Math.max(1, Math.floor(cfg.maxAthletes)))
      .filter((r, k) => k === 0 || r.score >= cfg.otherAthleteShare * best)
      .map((r) => r.label);
  }

  /**
   * The box of what moves inside `window` now: the group of pixels that moved lately that is most like a body (the biggest, but a flat bar
   * is not a body), with the groups that are big enough to be a part of the same body (a leg, a hand) and close enough to it, and no speck
   * of noise. A real bed goes down at every landing, shakes after, and carries the athlete's shadow, all in time with the jumps, and a line
   * of the wall flickers when the camera's move is taken out: they are bars, rows of moving pixels far wider than the body's rows, and are
   * taken out before the groups are made, so they neither are the athlete nor join them. When nothing like a body moves in the window
   * (the athlete stands on the bed) the athlete is where they were a frame ago, or the window itself: it is where they jump.
   */
  private boxIn(window: Box, before: Box | null): Box {
    const { width: w, height: h, cfg, held, moving } = this;
    const area = reachOf(window);
    const join = Math.max(1, Math.round(cfg.joinShare * Math.min(w, h)));
    moving.fill(0);
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) moving[y * w + x] = held[y * w + x] > 0 ? 1 : 0;
    }
    this.dropBars(area, join);
    // Grown a little so the edges of one body are one group.
    dilate(moving, this.joined, w, h, join, this.tmpBytes);
    const count = labelPieces(this.joined, this.labels, w, h, this.stack).length;
    const pixels = new Array<number>(count).fill(0);
    const groups: Box[] = Array.from({ length: count }, () => ({ x0: w, y0: h, x1: -1, y1: -1 }));
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        const i = y * w + x;
        if (!moving[i]) continue;
        const label = this.labels[i];
        const g = groups[label];
        pixels[label]++;
        g.x0 = Math.min(g.x0, x);
        g.x1 = Math.max(g.x1, x);
        g.y0 = Math.min(g.y0, y);
        g.y1 = Math.max(g.y1, y);
      }
    }
    const width = (b: Box) => b.x1 - b.x0 + 1;
    const height = (b: Box) => b.y1 - b.y0 + 1;
    // How much like a body a group is: its pixels, divided by how many times wider than `flatShape` heights it is.
    const bodyLike = (label: number) =>
      pixels[label] / Math.max(1, width(groups[label]) / (cfg.flatShape * height(groups[label])));
    let best = 0;
    for (let label = 1; label < count; label++) if (bodyLike(label) > bodyLike(best)) best = label;
    if (best === 0 || pixels[best] < cfg.minActivePixels) return before ?? { ...window };
    const body = groups[best];
    const box = { ...body };
    const reach = cfg.partReachShare * Math.max(height(body), width(body));
    for (let label = 1; label < count; label++) {
      if (label === best || pixels[label] < Math.max(cfg.minActivePixels, cfg.partShare * pixels[best])) continue;
      const g = groups[label];
      const gapY = Math.max(0, g.y0 - body.y1, body.y0 - g.y1);
      const gapX = Math.max(0, g.x0 - body.x1, body.x0 - g.x1);
      // A part of the same body is within a body length of it and no wider than it.
      if (gapY > reach || gapX > reach || width(g) > cfg.partWidthShare * width(body)) continue;
      box.x0 = Math.min(box.x0, g.x0);
      box.x1 = Math.max(box.x1, g.x1);
      box.y0 = Math.min(box.y0, g.y0);
      box.y1 = Math.max(box.y1, g.y1);
    }
    return box;
  }

  /**
   * Takes the bars out of `moving` inside `window`: the bed, its pads, a line of the wall. A bar is a row whose moving pixels (in runs of two
   * or more; gaps of up to `join` bridged) spread over more than `bedRowShare` times the typical row, as one run that wide or as pieces with
   * at least half a typical row of pixels outside the biggest of them (a body with a speck of noise far from it is not a bar). The typical
   * row is the 35th percentile of the rows' spreads: the body has more rows than the bed, and a tiny athlete over a thick bed still has
   * more narrow rows than that.
   */
  private dropBars(window: Box, join: number): void {
    const { width: w, cfg, moving } = this;
    const rows: { y: number; x0: number; x1: number; spread: number; biggest: number; outside: number }[] = [];
    for (let y = window.y0; y <= window.y1; y++) {
      let first = -1;
      let last = -1;
      let biggest = 0;
      let count = 0;
      let runStart = -1;
      let runLast = -1;
      const endRun = () => {
        const length = runLast - runStart + 1;
        if (length < 2) return;
        if (first < 0) first = runStart;
        last = runLast;
        biggest = Math.max(biggest, length);
      };
      for (let x = window.x0; x <= window.x1 + 1; x++) {
        const on = x <= window.x1 && moving[y * w + x] === 1;
        if (on) count++;
        if (on && runStart < 0) runStart = x;
        if (on) runLast = x;
        if (runStart >= 0 && !on && x - runLast > join) {
          endRun();
          runStart = -1;
        }
      }
      if (runStart >= 0) endRun();
      if (first < 0) continue;
      rows.push({ y, x0: first, x1: last, spread: last - first + 1, biggest, outside: count - biggest });
    }
    if (rows.length < 3) return;
    const spreads = rows.map((r) => r.spread).sort((a, b) => a - b);
    const typical = spreads[Math.floor(0.35 * spreads.length)];
    const bar = Math.max(typical * cfg.bedRowShare, typical + 4);
    for (const r of rows) {
      if (r.spread <= bar || (r.biggest <= bar && r.outside < Math.max(2, typical / 2))) continue;
      for (let x = window.x0; x <= window.x1; x++) moving[r.y * w + x] = 0;
    }
  }

  /** Keeps the picture in `box` and `margin` pixels around it, the edge soft over `featherShare`: added to `target` as the larger of the two. */
  private paintBox(box: Box, margin: number): void {
    const { width: w, height: h, cfg, target } = this;
    const feather = Math.max(1, Math.round(cfg.featherShare * Math.min(w, h)));
    // How far inside the edge a pixel is, in feathers: 0.5 on the edge, 1 a feather inside it, 0 a feather outside.
    const inside = (distance: number): number => clamp01(0.5 + distance / (2 * feather));
    const x0 = Math.max(0, box.x0 - margin - feather);
    const x1 = Math.min(w - 1, box.x1 + margin + feather);
    const y0 = Math.max(0, box.y0 - margin - feather);
    const y1 = Math.min(h - 1, box.y1 + margin + feather);
    for (let y = y0; y <= y1; y++) {
      const across = inside(Math.min(y - (box.y0 - margin), box.y1 + margin - y));
      for (let x = x0; x <= x1; x++) {
        const value = across * inside(Math.min(x - (box.x0 - margin), box.x1 + margin - x));
        if (value > target[y * w + x]) target[y * w + x] = value;
      }
    }
  }

  /** What every piece of the region (labels of `merged`) is: its pixels with evidence, how strong they are, its box and its width. */
  private measurePieces(count: number): Pieces {
    const { width: w, height: h, labels, on, evidence } = this;
    const area = new Array<number>(count).fill(0);
    const mass = new Array<number>(count).fill(0);
    const box: Box[] = Array.from({ length: count }, () => ({ x0: w, y0: h, x1: -1, y1: -1 }));
    const left = new Array<number>(count).fill(w);
    const right = new Array<number>(count).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const label = labels[i];
        if (!label) continue;
        const b = box[label];
        b.x0 = Math.min(b.x0, x);
        b.x1 = Math.max(b.x1, x);
        b.y0 = Math.min(b.y0, y);
        b.y1 = Math.max(b.y1, y);
        if (!on[i]) continue;
        area[label]++;
        mass[label] += evidence[i];
        if (x < left[label]) left[label] = x;
        if (x > right[label]) right[label] = x;
      }
    }
    return { area, mass, box, width: right.map((r, label) => Math.max(0, r - left[label] + 1)) };
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
      athletes: this.athletes,
      bodies: this.keptBodies,
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
        athleteShare: this.typeEstimator.athleteShare,
      },
    };
  }
}
