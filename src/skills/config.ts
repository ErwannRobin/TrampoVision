/**
 * Every threshold of the skill logic lives here, so it can be tuned from the UI, saved in the export and
 * replaced by learned values later. Angles are degrees; distances are fractions of a body length,
 * trunk length or leg length as noted.
 */

export interface BodyPositionThresholds {
  /** Hip angle (shoulder–hip–knee) at or below this: the hips are fully folded. */
  hipFoldedMaxDeg: number;
  /** Hip angle at or above this: the hips are open. In between the position is "transitional". */
  hipOpenMinDeg: number;
  /** Knee angle (hip–knee–ankle) at or above this: the legs are straight. */
  kneeStraightMinDeg: number;
  /** Knee angle at or below this: the knees are clearly bent. */
  kneeBentMaxDeg: number;
  /** Knee-to-torso distance (in trunk lengths) at or below this: the knees are drawn in (tuck evidence). */
  kneeTorsoNear: number;
  /** ...at or above this: the knees are far from the torso. */
  kneeTorsoFar: number;
  /** A position needs at least this rule score to be reported; otherwise "unknown". */
  minScore: number;
}

export interface RotationConfig {
  /** Rotation is rounded to a multiple of this (180 = half turns: 0, 180, 360, 540, 720...). */
  stepDeg: number;
  /** Distance from the nearest multiple at which the rounding confidence reaches 0. */
  toleranceDeg: number;
  /** Orientation change between two samples above this (deg) risks aliasing or a pose flip. */
  maxStepDeg: number;
  /** The orientation may move this far (deg) against the net rotation before the rotation confidence drops (noise, trunk flexing). */
  reversalOkDeg: number;
  /** ...and the confidence factor reaches its floor (0.2) at this many degrees. */
  reversalMaxDeg: number;
}

export interface FacingConfig {
  /** 'auto' estimates it from the pose; 'left' / 'right' = the athlete faces that side of the image when upright. */
  override: 'auto' | 'left' | 'right';
  /** Face points ahead of the ears by this many trunk lengths give a full-strength vote. */
  faceSaturation: number;
  /** Knee in front of the hip–ankle line by this many leg lengths gives a full-strength vote. */
  kneeSaturation: number;
  /** A facing estimate below this confidence is reported as undetermined. */
  minConfidence: number;
}

export interface LegSeparationConfig {
  /** Ankle distance / leg length at or below this is "low". */
  lowMax: number;
  /** ...at or above this is "high". */
  highMin: number;
}

export interface SkillConfig {
  /** Samples per normalized jump sequence. */
  sequenceSamples: number;
  /** Part of the flight (fractions of its duration) used to find the body position; the ends are transitions. */
  positionWindow: [number, number];
  /** Frames within this many degrees of the smallest hip angle define the "most closed" moment. */
  peakBandDeg: number;
  /** The most closed shape must be held for at least this share of the window to count fully. */
  minHoldShare: number;
  position: BodyPositionThresholds;
  rotation: RotationConfig;
  facing: FacingConfig;
  legSeparation: LegSeparationConfig;
  /** Predictions below this confidence are reported as unclassified. */
  minConfidence: number;
  /** Trunk length changing by more than this share during a flight means the camera is not side-on. */
  maxTrunkVariation: number;
}

export const DEFAULT_SKILL_CONFIG: SkillConfig = {
  sequenceSamples: 32,
  positionWindow: [0.1, 0.9],
  peakBandDeg: 12,
  minHoldShare: 0.3,
  position: {
    hipFoldedMaxDeg: 125,
    hipOpenMinDeg: 155,
    kneeStraightMinDeg: 150,
    kneeBentMaxDeg: 115,
    kneeTorsoNear: 0.55,
    kneeTorsoFar: 0.85,
    minScore: 0.4,
  },
  rotation: { stepDeg: 180, toleranceDeg: 60, maxStepDeg: 120, reversalOkDeg: 25, reversalMaxDeg: 90 },
  facing: { override: 'auto', faceSaturation: 0.1, kneeSaturation: 0.06, minConfidence: 0.35 },
  legSeparation: { lowMax: 0.15, highMin: 0.4 },
  minConfidence: 0.3,
  maxTrunkVariation: 0.25,
};

/** Merges a partial config into the defaults (one level of nesting). */
export function mergeSkillConfig(partial: DeepPartial<SkillConfig> = {}): SkillConfig {
  const d = DEFAULT_SKILL_CONFIG;
  return {
    ...d,
    ...(partial as Partial<SkillConfig>),
    position: { ...d.position, ...partial.position },
    rotation: { ...d.rotation, ...partial.rotation },
    facing: { ...d.facing, ...partial.facing },
    legSeparation: { ...d.legSeparation, ...partial.legSeparation },
    positionWindow: (partial.positionWindow as [number, number] | undefined) ?? d.positionWindow,
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
