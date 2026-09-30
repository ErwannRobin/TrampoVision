/**
 * What the execution check compares the measurements with. The deductions and their sizes are the FIG Code of Points 2025-2028
 * (Trampoline, Part I §20.2); the angles that decide whether a deduction applies are estimates, made a little more lenient than
 * the Code's own because a 2D pose model reads a straight body or straight legs some degrees short. They have not been tuned on
 * footage judged by FIG judges: a coach's own scores (saved with each skill) are what would tune them.
 */

export const EXECUTION_RULESET = 'FIG Code of Points 2025-2028, Trampoline, Part I §20.2; thresholds estimated';

/** Positions of the body in the last somersault as fractions of it: 12 o'clock is upside down at the top, 3 o'clock is horizontal on the way down. */
export const CLOCK = {
  /** 10 o'clock: the earliest a multiple somersault may be open (§20.2.1.3). */
  ten: 4 / 12,
  /** 12 o'clock. */
  twelve: 6 / 12,
  one: 7 / 12,
  two: 8 / 12,
  /** 3 o'clock: from here on nothing is judged, the athlete prepares the landing (§20.2.1). */
  three: 9 / 12,
} as const;

export interface ExecutionConfig {
  /** Nothing is judged before this share of the flight: the shape at takeoff is not the position. */
  skipTakeoffU: number;
  /** A jump without somersault is judged until this share of the flight. */
  jumpEndU: number;
  /** Fewer usable samples in the judged part than this and the skill is not checked. */
  minSamples: number;
  /** Below this trust in the pose over the flight (see `JumpFeatures.quality.pose`) a skill is not judged: the angles are mostly filled in. */
  minQuality: number;
  /** Below this confidence in the rotation (a pose that flipped, an orientation that went back and forth) the body is not placed on the clock. */
  minRotationConfidence: number;
  /** The rotation measured must be at least this share of the element's somersaults to place the body on the clock. */
  minRotationShare: number;
  /** ... and at most this share (a count that is off by a whole somersault is not the element that was named). */
  maxRotationShare: number;
  /** Tolerance on the clock, as a share of the somersault: the timing of the opening is read from 32 samples of the flight. */
  clockTolerance: number;

  /** Median knee angle over the judged part, degrees: straight legs are at or above `kneeStraightDeg` (§20.2.1.2: 0.1 to 0.2). */
  kneeStraightDeg: number;
  /** Below this the knees are clearly bent: the larger deduction. */
  kneeBentDeg: number;

  /** A tuck or pike is folded when the hips reach this angle or less. Fewer fold and the opening is not judged. */
  foldedHipDeg: number;
  /** Open when the hips are at this angle or more (the Code says 180°, §20.2.1.3; a body that is straight reads 165° or more, and a missed opening costs 0.3, so this errs on the side of the athlete). */
  openHipDeg: number;
  /** After opening the hips must stay above this, else 0.1 (the Code: 171° to 190° is no deduction and 136° to 170° is 0.1, §20.2.1.5; this leaves room for the pose noise) ... */
  pikeDownMildDeg: number;
  /** ... and below this 0.2 (the Code: 135° or less). */
  pikeDownDeepDeg: number;

  /** A layout: the median hip angle should be at or above this (else 0.1), and above this minus `bodyLineDeepMarginDeg` (else 0.2). */
  layoutHipDeg: number;
  bodyLineDeepMarginDeg: number;

  /** Angle between the upper arm and the trunk line, degrees (§13.6: 45° up to a full twist, 90° for more), plus this margin for the pose noise. */
  armLimitDeg: number;
  armLimitTwistingDeg: number;
  armMarginDeg: number;
  /** Elbow angle below this is a bent arm (§20.2.1.1: elements of 540° of twist or less). */
  elbowFlexDeg: number;

  /** No single skill loses more than this to form and control (§20.2.1). */
  maxDeduction: number;
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  skipTakeoffU: 0.12,
  jumpEndU: 0.8,
  minSamples: 8,
  minQuality: 0.4,
  minRotationConfidence: 0.35,
  minRotationShare: 0.6,
  maxRotationShare: 1.4,
  clockTolerance: 0.02,
  kneeStraightDeg: 165,
  kneeBentDeg: 150,
  foldedHipDeg: 140,
  openHipDeg: 150,
  pikeDownMildDeg: 140,
  pikeDownDeepDeg: 125,
  layoutHipDeg: 160,
  bodyLineDeepMarginDeg: 15,
  armLimitDeg: 45,
  armLimitTwistingDeg: 90,
  armMarginDeg: 10,
  elbowFlexDeg: 135,
  maxDeduction: 0.5,
};
