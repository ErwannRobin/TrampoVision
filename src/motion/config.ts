/**
 * Thresholds of the experimental trampoline motion detector (`src/motion/`). Like the skill thresholds, these are my estimates:
 * tuned on synthetic scenes (`testScenes.ts`) and not on real trampoline footage. Sizes marked "picture pixels" are pixels of
 * the small working picture (`workWidth` wide), not of the video; shares of the picture are shares of its shorter side.
 */
export interface MotionConfig {
  /**
   * Width of the small picture the motion is measured on, picture pixels (the height follows the video). Small on purpose: it
   * averages the noise of the video out, and it keeps the move of an athlete between two frames within what the flow can follow.
   */
  workWidth: number;

  // Stage 1: the vertical motion between two frames.
  /** Radius of the window the flow is fitted on, picture pixels (4 = a window of 9 × 9): the size of a body part, so a window holds edges that point several ways. */
  flowRadius: number;
  /** Lowest noise level of the frame difference, intensity 0..1. Stops a perfectly still picture from making every change look huge. */
  noiseFloor: number;
  /** A window whose motion is this many noise levels strong counts a little / fully. */
  minSignificance: number;
  fullSignificance: number;
  /** Slowest vertical move that counts a little / fully, picture pixels per analyzed frame. */
  minSpeed: number;
  fullSpeed: number;
  /** A pixel keeps its vertical motion when this share of its motion (vertical against sideways) is vertical: a little / fully above these. */
  minDominance: number;
  fullDominance: number;
  /** A window needs this many times the gradient energy that noise alone gives, or it has no texture to follow. */
  minTexture: number;
  /** Share of a window's gradient energy added to the diagonal of its equations: what keeps a window that is one edge from giving an answer along it. */
  regularization: number;
  /**
   * A camera that shakes moves the whole picture. It is taken out when this share of the columns has texture to follow, half of them
   * agree within `shakeSpread` picture pixels (a column fits a vertical speed over its whole height) and they reach both sides of the picture.
   */
  minShakeColumns: number;
  shakeSpread: number;

  // Stage 2: following the movement over consecutive frames.
  /** How long a pixel remembers that something moved up or down through it, seconds (a jump is 1 to 2.5 s long). */
  holdS: number;

  // Stage 3: is the movement periodic?
  /** The time over which the rhythm of a column is measured, seconds. Two and a half periods of the slowest jump must fit. */
  rhythmWindowS: number;
  /** Jump periods looked for, seconds. A bounce on the bed is about 1 s, a high skill up to 2.5 s; a waving hand or a step is under 0.6 s. */
  minPeriodS: number;
  maxPeriodS: number;
  /** A column whose motion repeats this well counts a little / fully (the normalized autocorrelation at the period). */
  minRhythm: number;
  fullRhythm: number;
  /** The strength of a column follows its readings with this time constant, seconds: a rhythm that comes and goes is noise. */
  rhythmSmoothS: number;
  /** The autocorrelation must have been below minus this before the period: going up and then down, not a slow drift. */
  minTrough: number;
  /** Columns whose direction signal has less power than this (mean square) are too quiet to have a rhythm. */
  minActivity: number;

  // Stage 4: the mask, and keeping it still.
  /** Evidence (motion that is both repeated up and down, and periodic) at which a pixel joins the athlete region / stays in it. */
  enterEvidence: number;
  stayEvidence: number;
  /** Pieces of the region closer than this are one athlete: the share of the picture. */
  mergeShare: number;
  /** A region needs this share of the picture to be an athlete: a hand waving is not. */
  minAreaShare: number;
  /** How far the mask reaches around the region, share of the picture. The pose model needs the arms and the legs too. */
  marginShare: number;
  /** Softness of the mask edge, share of the picture. */
  featherShare: number;
  /** Time the mask takes to open where the athlete is / to close where the athlete is not, seconds. Closing slowly is what stops flicker. */
  openS: number;
  closeS: number;
  /** A gap between two frames longer than this is a cut (a seek): what was learned about the last frames no longer applies, seconds. */
  maxGapS: number;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  workWidth: 128,

  flowRadius: 4,
  noiseFloor: 0.002,
  minSignificance: 6,
  fullSignificance: 14,
  minSpeed: 0.12,
  fullSpeed: 0.3,
  minDominance: 0.55,
  fullDominance: 0.85,
  minTexture: 4,
  regularization: 0.1,
  minShakeColumns: 0.4,
  shakeSpread: 0.15,

  holdS: 2.5,

  rhythmWindowS: 8,
  minPeriodS: 0.65,
  maxPeriodS: 2.6,
  minRhythm: 0.3,
  fullRhythm: 0.55,
  rhythmSmoothS: 0.6,
  minTrough: 0.1,
  minActivity: 0.01,

  enterEvidence: 0.3,
  stayEvidence: 0.1,
  mergeShare: 0.04,
  minAreaShare: 0.004,
  marginShare: 0.1,
  featherShare: 0.04,
  openS: 0.15,
  closeS: 0.8,
  maxGapS: 0.5,
};

export function mergeMotionConfig(partial?: Partial<MotionConfig>): MotionConfig {
  return { ...DEFAULT_MOTION_CONFIG, ...partial };
}
