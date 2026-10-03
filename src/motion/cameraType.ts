import type { CameraType, MotionConfig } from './config';

/** What `CameraTypeEstimator` reads from every frame. */
export interface CameraSample {
  /** Seconds since the last frame. */
  dt: number;
  /** How the picture moved since the last frame, picture pixels (0 when the camera estimate was not sure). */
  dx: number;
  dy: number;
  /** The width of the athlete's region, as a share of the picture's width; null while no athlete is found. */
  athleteWidthShare: number | null;
}

/**
 * Changes made to the thresholds while a kind of shot is in use, on top of what the person set.
 *
 * - `tracking`: the move of the camera is measured, not exact, and what it leaves of the background moves a little, like the camera did.
 *   Only a move that is bigger than that counts (the athlete moves a few pixels a frame).
 * - `lowAngle`: the athlete is big, so a piece of motion has to be bigger to count (the lights of the ceiling flicker, and a wide
 *   region is never a hand).
 *
 * Like all the thresholds, an estimate that no real footage has tuned yet.
 */
export const CAMERA_PROFILES: Record<CameraType, Partial<MotionConfig>> = {
  fixed: {},
  tracking: { minSpeed: 0.2, fullSpeed: 0.45 },
  lowAngle: { minAreaShare: 0.02 },
};

/** The athlete's width follows its readings with this time constant, seconds; and with no athlete found it is forgotten with this one. */
const WIDTH_SMOOTH_S = 1.5;
const WIDTH_FORGET_S = 4;

/**
 * Which of three kinds of shot a video is, from the first seconds of it and then all the time:
 *
 * - `tracking`: the camera moves, a close-up that follows the athlete, or a pan. Seen as its speed: the moves of the picture, smoothed over
 *   `cameraSmoothS`, and their root mean square over `cameraWindowS`. A speed and not a position, because the error of every frame adds up
 *   in a position (a camera that stands still seems to wander) and does not in a speed; and smoothed, because the shake of a hand is a
 *   position that jumps back and forth, which makes a speed that averages out.
 * - `lowAngle`: the camera stands still, close to the bed and looking up, so the athlete is big in the picture: wider than
 *   `lowAngleShare` of it. It is told from the width, not the height: the region an athlete jumps through is tall in every shot.
 * - `fixed`: the camera stands still and the athlete is small in a wide picture.
 *
 * Every change has a high and a low threshold, and the shot stays what it is for `cameraHoldS` seconds before it can change, so it does not
 * flicker between two kinds. It starts as `fixed`, which is the way the detector worked before it knew about cameras.
 */
export class CameraTypeEstimator {
  private smoothX = 0;
  private smoothY = 0;
  private power = 0;
  private width = 0;
  private moving = false;
  private wide = false;
  private sinceChangeS = Infinity;
  private kind: CameraType = 'fixed';
  /** How fast the camera moves, shorter sides of the picture a second (smoothed). */
  speed = 0;

  constructor(private readonly cfg: MotionConfig) {}

  get type(): CameraType {
    return this.kind;
  }

  reset(): void {
    this.smoothX = this.smoothY = this.power = this.width = this.speed = 0;
    this.moving = false;
    this.wide = false;
    this.sinceChangeS = Infinity;
    this.kind = 'fixed';
  }

  /** Takes the next frame (`short` is the shorter side of the picture, pixels) and returns the kind of shot. */
  push(sample: CameraSample, short: number): CameraType {
    const { cfg } = this;
    const { dt } = sample;
    const smooth = 1 - Math.exp(-dt / Math.max(1e-3, cfg.cameraSmoothS));
    this.smoothX += (sample.dx / dt - this.smoothX) * smooth;
    this.smoothY += (sample.dy / dt - this.smoothY) * smooth;
    const window = 1 - Math.exp(-dt / Math.max(1e-3, cfg.cameraWindowS));
    this.power += (this.smoothX ** 2 + this.smoothY ** 2 - this.power) * window;
    this.speed = Math.sqrt(this.power) / Math.max(1, short);

    if (sample.athleteWidthShare !== null) {
      const follow = this.width > 0 ? 1 - Math.exp(-dt / WIDTH_SMOOTH_S) : 1;
      this.width += (sample.athleteWidthShare - this.width) * follow;
    } else {
      this.width *= Math.exp(-dt / WIDTH_FORGET_S);
    }

    this.moving = this.speed >= cfg.cameraMovingSpeed || (this.moving && this.speed > cfg.cameraStillSpeed);
    this.wide = this.width >= cfg.lowAngleShare || (this.wide && this.width > cfg.lowAngleFreeShare);
    const wanted: CameraType = this.moving ? 'tracking' : this.wide ? 'lowAngle' : 'fixed';
    this.sinceChangeS += dt;
    if (wanted !== this.kind && this.sinceChangeS >= cfg.cameraHoldS) {
      this.kind = wanted;
      this.sinceChangeS = 0;
    }
    return this.kind;
  }
}
