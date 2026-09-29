/**
 * Thresholds of the experimental twist estimator. Like the skill thresholds, these are my estimates and are
 * not tuned on real trampoline footage; the ones that came from a measurement say so.
 */
export interface TwistConfig {
  /** Landmarks below this model visibility are treated as missing. */
  minVisibility: number;
  /** Longest gap in the 3D data that is bridged by interpolation, seconds. */
  maxGapS: number;
  /** A shoulder or hip line that is less than this share perpendicular to the trunk axis is skipped in that frame. */
  minLateralShare: number;
  /**
   * A twist step between two consecutive samples larger than this is not a real twist at normal frame rates
   * (2700 deg/s at 30 fps): it is a left/right label swap or aliasing. Such a step is folded into (-90, 90] and counted.
   */
  maxStepDeg: number;
  /** Twist is counted in half twists. */
  stepDeg: number;
  /** A twist this far (degrees) from a multiple of `stepDeg` gets a rounding score of 0. */
  toleranceDeg: number;
  /** Move against the net twist direction that is still fine / that makes the twist unusable (degrees). */
  reversalOkDeg: number;
  reversalMaxDeg: number;
  /**
   * Variation (std / mean) of the 3D shoulder width over the flight. A rigid body has a constant width, so anything above
   * the noise floor is depth error. Measured: 0.4-1% on the still photo (non-rotating jumps), 6.8% during its somersault.
   */
  widthCvOk: number;
  widthCvMax: number;
  /** Two twist estimates (shoulders vs hips, full 3D axis vs image-plane axis) that differ by less / more than this (degrees) score 1 / the floor. */
  agreeOkDeg: number;
  agreeMaxDeg: number;
  /** Confidence at which a twist is shown as a measurement instead of "not reliable". */
  minConfidence: number;
  /** Smoothing window of the angular velocity, seconds. */
  velocitySmoothS: number;
  /** Below this net twist the body is not considered to twist in either direction. */
  directionMinDeg: number;
}

export const DEFAULT_TWIST_CONFIG: TwistConfig = {
  minVisibility: 0.5,
  maxGapS: 0.2,
  minLateralShare: 0.5,
  maxStepDeg: 90,
  stepDeg: 180,
  toleranceDeg: 60,
  reversalOkDeg: 25,
  reversalMaxDeg: 90,
  widthCvOk: 0.05,
  widthCvMax: 0.25,
  agreeOkDeg: 30,
  agreeMaxDeg: 120,
  minConfidence: 0.5,
  velocitySmoothS: 0.1,
  directionMinDeg: 45,
};

export function mergeTwistConfig(partial?: Partial<TwistConfig>): TwistConfig {
  return { ...DEFAULT_TWIST_CONFIG, ...partial };
}
