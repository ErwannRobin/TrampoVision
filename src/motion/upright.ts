import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';

/** A landmark with less visibility than this is a guess: the trunk angle is not read from it. */
const SEEN = 0.3;
/** A trunk shorter than this, in the pixels of the picture, is a body folded onto itself or two points on top of each other: it has no direction. */
const MIN_TRUNK_PX = 6;

/** Turns of one degree to the right (clockwise in the picture): 0 is a trunk standing upright, 90 is lying with the head to the right, 180 is upside down. */
export const wrapDegrees = (deg: number): number => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
};

/**
 * The angle of a body in the picture, from the hips to the shoulders: 0 when the shoulders are straight above the hips, positive when they
 * lean to the right (clockwise as seen in the video), 180 when the body is upside down. Null when the four points are not seen, or the trunk
 * is too short to have a direction. `width` and `height` are the picture's size: the landmarks are 0 to 1, and a pixel is the same on both axes.
 */
export function trunkAngle(landmarks: Keypoint[], width: number, height: number): number | null {
  const points = [landmarks[LM.L_SHOULDER], landmarks[LM.R_SHOULDER], landmarks[LM.L_HIP], landmarks[LM.R_HIP]];
  if (points.some((p) => !p || p.visibility < SEEN)) return null;
  const shoulders = { x: ((points[0].x + points[1].x) / 2) * width, y: ((points[0].y + points[1].y) / 2) * height };
  const hips = { x: ((points[2].x + points[3].x) / 2) * width, y: ((points[2].y + points[3].y) / 2) * height };
  const dx = shoulders.x - hips.x;
  const dy = shoulders.y - hips.y;
  if (Math.hypot(dx, dy) < MIN_TRUNK_PX) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** How much of the new reading enters the angle and the rate of turn. A body that turns keeps its rate: the rate is what carries the angle over a frame the model lost. */
const ANGLE_GAIN = 0.65;
const RATE_GAIN = 0.3;
/** The fastest turn believed, degrees a frame: a double somersault turns about 15, and a reading that says more is a body the model got wrong. */
const MAX_RATE = 40;
/** What is left of the rate after a frame in which nobody was found, and the number of such frames after which the angle is forgotten. */
const LOST_RATE_KEPT = 0.95;
const MAX_LOST = 10;

/**
 * Follows how far the athlete is turned, frame after frame, so that the picture can be turned back before the pose model looks at it. The
 * model's own reading of the angle is the measurement; two things are done to it that the model cannot do for itself:
 *
 * - It can be 180° off: with the athlete upside down, tucked and blurred, the model sometimes puts the head where the feet are. A real body
 *   cannot turn half a revolution between two frames (a double somersault turns about 15° a frame), so of the two readings, as measured and
 *   turned over, the one nearest to where the turn was heading is taken. (The same idea as `trackOrientation`, which repairs a whole track
 *   afterwards; this one has to say, frame by frame, what the next frame will look like, and cannot see ahead.)
 * - Turning goes on when the model loses the athlete: a body in the air turns at the same rate until it lands, so the angle is carried on with
 *   the last rate (fading), for a few frames.
 *
 * The angle is continuous (it goes past 180 and 360 when the athlete does a somersault); `predict` gives it wrapped.
 */
export class UprightTracker {
  private angle = 0;
  private rate = 0;
  private known = false;
  private lost = 0;

  /** Forgets the athlete: the next frame is read as it is. */
  reset(): void {
    this.angle = this.rate = this.lost = 0;
    this.known = false;
  }

  /** Whether the tracker has an angle at all (it has seen the athlete lately). */
  get tracking(): boolean {
    return this.known;
  }

  /** How fast the athlete turns, degrees a frame (positive is clockwise). */
  get turn(): number {
    return this.rate;
  }

  /** The angle the athlete will have in the next frame, wrapped to -180..180: 0 when it is not known. */
  predict(): number {
    return this.known ? wrapDegrees(this.angle + this.rate) : 0;
  }

  /** Takes what the model read in this frame, as the angle of the trunk (`trunkAngle`), or null when the athlete was not found. */
  update(measured: number | null): void {
    if (measured === null) {
      if (!this.known) return;
      this.lost++;
      if (this.lost > MAX_LOST) return this.reset();
      this.angle += this.rate;
      this.rate *= LOST_RATE_KEPT;
      return;
    }
    if (!this.known) {
      this.angle = measured;
      this.rate = 0;
      this.known = true;
      this.lost = 0;
      return;
    }
    const predicted = this.angle + this.rate;
    // As read, or turned over: the one the turn was heading for.
    const asRead = wrapDegrees(measured - predicted);
    const turnedOver = wrapDegrees(measured + 180 - predicted);
    const innovation = Math.abs(asRead) <= Math.abs(turnedOver) ? asRead : turnedOver;
    this.angle = predicted + ANGLE_GAIN * innovation;
    this.rate = Math.max(-MAX_RATE, Math.min(MAX_RATE, this.rate + RATE_GAIN * innovation));
    this.lost = 0;
  }
}
