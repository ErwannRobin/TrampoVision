import type { Channel } from './temporal/signature';
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

/** Tolerances of the hierarchical classifier: how much noise each measurement is expected to have. */
export interface ClassificationConfig {
  /** Standard deviation of the measured somersault rotation, degrees, for a clean measurement (noisier data widens it). */
  rotationSigmaDeg: number;
  /** A somersault that falls short of the whole number is more likely than one that goes past it (the flight ends at touchdown, before the body finishes rotating): the tolerance below it is this many times wider. */
  underRotationFactor: number;
  /** Real somersaults measure short of the whole number of turns (0.79 to 0.90 for a full one, seen on real footage): the expected reading of n somersaults is n × (1 - this). */
  underReadFraction: number;
  /** Same for the rotation path length (sum of |orientation steps|), in turns. Weak second opinion on the count. */
  pathSigmaTurns: number;
  /** Prior weight of a rotation that is not a whole number of somersaults (quarter and half rotations; 1 = as likely as a whole one). */
  offGridPrior: number;
  /** Standard deviation of the measured twist, degrees, for a reliable measurement. */
  twistSigmaDeg: number;
  /** Prior weight of each extra half twist when twist is not measured (1 = as likely as no twist). */
  unmeasuredTwistWeight: number;
  /** Twist still changing by more than this in the last tenth of the flight means the landing came before the twist ended, degrees. */
  twistSettleDeg: number;
}

/** The temporal comparison: how a jump is matched against the reference signatures (see `temporal/`). */
export interface TemporalConfig {
  /** How far the time axes may drift apart in the warping, as a share of the flight. */
  bandFraction: number;
  /** Cost of being off the diagonal of the warping: timing counts, not only shape. */
  warpPenalty: number;
  /** Tolerance of the final rotation and twist, in turns, and how much a miss counts: a flight that ends a quarter turn off is not that skill, whatever its shape. */
  endSigma: number;
  endWeight: number;
  /** The tolerance of the final rotation is this many times wider when the jump ends short of the reference (see `underRotationFactor`). */
  endUnderFactor: number;
  /** Distance (in tolerances) at which the similarity falls to 0.6. */
  similarityScale: number;
  /** Tolerance of each channel, in the channel's own unit: a difference of this size costs 1. */
  sigma: Record<Channel, number>;
  /** Importance of each channel. */
  weights: Record<Channel, number>;
  /** The similarity of the trajectories is a likelihood on top of the structural probability of each element, raised to this power (0 = ignored, 1 = as it is). */
  similarityExponent: number;
  /** A candidate is plausible, and the jump is named even at low confidence (as tentative), when its similarity and structural probability both reach these. */
  plausibleSimilarity: number;
  plausibleStructure: number;
  /** ... unless the rotation is further than this many degrees from the nearest whole somersault: a quarter turn is a different skill or a measurement error, not a loose somersault. */
  maxOffGridDeg: number;
  /** Confidence from which a name is called confident, and from which it is called probable (below it: tentative). */
  confidentAt: number;
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
  classification: ClassificationConfig;
  temporal: TemporalConfig;
  /** Predictions below this confidence are reported as unclassified (unless `forceGuess`). */
  minConfidence: number;
  /**
   * Always name a complete jump. The closest element of the table is given as a tentative guess (with the reason it is weak) instead of
   * "unclassified", and a somersault whose direction cannot be told is named with the likelier direction. Off: the classifier declines.
   */
  forceGuess: boolean;
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
  classification: {
    rotationSigmaDeg: 36,
    underRotationFactor: 2,
    underReadFraction: 0.1,
    pathSigmaTurns: 0.3,
    offGridPrior: 0.15,
    twistSigmaDeg: 50,
    unmeasuredTwistWeight: 0.05,
    twistSettleDeg: 60,
  },
  temporal: {
    bandFraction: 0.12,
    warpPenalty: 0.5,
    endSigma: 0.15,
    endWeight: 1,
    endUnderFactor: 2,
    similarityScale: 1.4,
    sigma: {
      somersault: 0.2,
      twist: 0.25,
      hip: 0.2,
      knee: 0.25,
      shoulderHip: 0.35,
      comHeight: 0.35,
      angVel: 1.2,
      orientSin: 0.5,
      orientCos: 0.5,
    },
    weights: {
      somersault: 3,
      twist: 2.5,
      hip: 2,
      knee: 1,
      shoulderHip: 0.3,
      comHeight: 0.4,
      angVel: 1,
      orientSin: 0.5,
      orientCos: 0.5,
    },
    similarityExponent: 1,
    plausibleSimilarity: 0.15,
    plausibleStructure: 0.01,
    maxOffGridDeg: 55,
    confidentAt: 0.6,
  },
  minConfidence: 0.3,
  forceGuess: true,
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
    classification: { ...d.classification, ...partial.classification },
    temporal: {
      ...d.temporal,
      ...partial.temporal,
      sigma: { ...d.temporal.sigma, ...partial.temporal?.sigma },
      weights: { ...d.temporal.weights, ...partial.temporal?.weights },
    },
    positionWindow: (partial.positionWindow as [number, number] | undefined) ?? d.positionWindow,
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
