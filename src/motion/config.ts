/**
 * Thresholds of the experimental trampoline motion detector (`src/motion/`). Like the skill thresholds, these are my estimates:
 * tuned on synthetic scenes (`testScenes.ts`) and not on real trampoline footage. Sizes marked "picture pixels" are pixels of
 * the small working picture (`workWidth` wide), not of the video; shares of the picture are shares of its shorter side.
 */
/** The kind of shot: what the camera does and where it stands, which decides how the picture is prepared (`cameraType.ts`). `auto` finds it out. */
export type CameraType = 'fixed' | 'tracking' | 'lowAngle';
export type CameraSetting = 'auto' | CameraType;

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

  // Camera: how the whole picture moves, and what kind of shot it is (see `CameraMotion` and `CameraTypeEstimator`).
  /** `auto` reads the kind of shot from the video; the others force it (the debug page's choice). */
  cameraType: CameraSetting;
  /** The camera estimate is trusted when its standard error is below this, picture pixels. */
  cameraMaxError: number;
  /**
   * The camera counts as moving (a close-up that follows the athlete, a pan) when its speed, in shorter sides of the picture a second,
   * averaged as a root mean square over `cameraWindowS` seconds, is at `cameraMovingSpeed` or more, and as still again below
   * `cameraStillSpeed`. The speed is smoothed over `cameraSmoothS` seconds first: the shake of a hand goes back and forth, and a camera
   * that follows goes somewhere.
   */
  cameraMovingSpeed: number;
  cameraStillSpeed: number;
  cameraWindowS: number;
  cameraSmoothS: number;
  /** What a camera that moves leaves of the background, as a share of its own speed: motion that slow, on top of the thresholds, is not the scene. */
  cameraSlack: number;
  /**
   * A still camera is low-angle when the athlete is this wide (share of the picture's shorter side, so that a video held upright and one held
   * sideways read the same) or wider, and a normal wide shot below the lower one. The box of an athlete is about 0.22 of the shorter side wide when
   * they are a third of its height, and 0.37 when they are more than half of it.
   */
  lowAngleShare: number;
  lowAngleFreeShare: number;
  /** The kind of shot stays this long before it can change, seconds. */
  cameraHoldS: number;

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

  // Stage 4: the athlete, and the mask around them.
  /** Evidence (motion that is both repeated up and down, and periodic) at which a pixel joins the athlete region / stays in it. */
  enterEvidence: number;
  stayEvidence: number;
  /** Pieces of the region closer than this are one region: the share of the picture. */
  mergeShare: number;
  /** A region needs this share of the picture to be an athlete: a hand waving is not. */
  minAreaShare: number;
  /**
   * How many people are kept: the regions with the strongest up and down motion, and no others. The video is of one person who jumps, so 1;
   * 2 for synchro (two trampolines). A person who stands, or who moves less than `otherAthleteShare` of the strongest, is hidden.
   */
  maxAthletes: number;
  /** A region after the first is kept only when its evidence is this share of the strongest region's. */
  otherAthleteShare: number;
  /** The region that was followed is replaced by another only when that one has this many times its evidence (it counts as stronger than it is). */
  switchRatio: number;

  // The box around the athlete: what moves in the jump's columns right now.
  /** A pixel is moving when its change since the last frame is this many noise levels (after the shake of the camera is taken out). */
  activeLevel: number;
  /** A pixel that moved counts as moving this long, seconds: at the top of a jump the athlete stops for a frame. */
  activeHoldS: number;
  /** Moving pixels closer than this are one body (a hand and a trunk): the share of the picture. */
  joinShare: number;
  /** A group of moving pixels needs this many pixels (picture pixels) to be the athlete: a speck of noise is not. */
  minActivePixels: number;
  /** Another group is part of the athlete (a leg, an arm) when it has this share of the pixels of the biggest group. */
  partShare: number;
  /** How far the mask reaches around the box of the athlete, share of the picture. The pose model needs the hands and the feet too. */
  marginShare: number;
  /** Softness of the mask edge, share of the picture. */
  featherShare: number;
  /** Time the background takes to fade once an athlete is found / the picture takes to come back when they are lost, seconds. */
  fadeInS: number;
  fadeOutS: number;
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

  cameraType: 'auto',
  cameraMaxError: 0.12,
  cameraMovingSpeed: 0.065,
  cameraStillSpeed: 0.035,
  cameraWindowS: 1.5,
  cameraSmoothS: 0.5,
  cameraSlack: 0.25,
  lowAngleShare: 0.36,
  lowAngleFreeShare: 0.3,
  cameraHoldS: 2,

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
  maxAthletes: 1,
  otherAthleteShare: 0.3,
  switchRatio: 1.6,

  activeLevel: 5,
  activeHoldS: 0.15,
  joinShare: 0.03,
  minActivePixels: 4,
  partShare: 0.25,
  marginShare: 0.05,
  featherShare: 0.04,
  fadeInS: 0.6,
  fadeOutS: 0.6,
  maxGapS: 0.5,
};

export function mergeMotionConfig(partial?: Partial<MotionConfig>): MotionConfig {
  return { ...DEFAULT_MOTION_CONFIG, ...partial };
}
