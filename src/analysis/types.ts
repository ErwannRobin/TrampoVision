import type { Keypoint, WorldPoint } from '../pose/types';
import type { TrampolineCalibration } from './calibration';
import type { JumpAnalysis } from './jumpCycles';
import type { StabilizeStats } from './stabilize';

/** Raw output of the pose stage: one entry per analyzed video frame. Pixel coordinates. */
export interface PoseTrack {
  width: number;
  height: number;
  /** Sampling rate of `frames` in Hz (source fps / stride). */
  fps: number;
  sourceFps: number;
  /** Frame start times in seconds. */
  times: number[];
  /** Athlete landmarks per sample (33 points, pixels, y down) or null if nobody was found. */
  frames: (Keypoint[] | null)[];
  /**
   * The same athlete's 3D landmarks per sample, in meters (33 points). MediaPipe "world" frame: origin at the hip center,
   * axes aligned with the camera (x right, y down, z away from the camera); measured on real output, it turns with the
   * body in the image plane. Absent when the pose backend gives no 3D, null where nobody was found.
   */
  world?: (WorldPoint[] | null)[];
  backend: string;
}

export const JOINT_NAMES = [
  'leftElbow',
  'rightElbow',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

export type ScaleSource = 'athlete' | 'trampoline';

export interface AnalysisOptions {
  /** Athlete height in meters, used to convert pixels to meters (approximate). */
  athleteHeightM: number;
  /** Landmarks below this visibility are treated as missing and interpolated. */
  minVisibility: number;
  /** Manual trampoline calibration (bed corners). Null/undefined = uncalibrated. */
  calibration?: TrampolineCalibration | null;
  /**
   * Where meters come from. 'trampoline' uses the bed size (needs a calibration), 'athlete' uses the
   * athlete height. 'auto' picks the trampoline when a calibration exists.
   */
  scaleSource?: ScaleSource | 'auto';
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  athleteHeightM: 1.75,
  minVisibility: 0.4,
  calibration: null,
  scaleSource: 'auto',
};

export interface AnalysisSummary {
  maxHeightM: number;
  peakUpVelocity: number;
  peakDownVelocity: number;
  totalRotationDeg: number;
  validFraction: number;
  /** Jumps found (some may be cut off at the clip edges). */
  jumpCount: number;
  /** Whole somersaults completed, summed over all complete jumps (forward and backward both count). */
  completedRotations: number;
}

/**
 * Everything derived from a PoseTrack, as parallel arrays indexed by sample. NaN = no data.
 * Angles are image-plane (2D) projections, so they are only exact when the camera looks
 * perpendicular to the plane of motion.
 */
export interface AnalysisResult {
  meta: {
    width: number;
    height: number;
    /** Sampling rate of the arrays below, Hz. */
    fps: number;
    sourceFps: number;
    count: number;
    backend: string;
    athleteHeightM: number;
    /** Scale used for every meter value. NaN when it couldn't be estimated (then meter values are NaN). */
    pixelsPerMeter: number;
    scaleSource: ScaleSource;
    /** Scale from the athlete's height and skeleton length, always computed (NaN if unknown). */
    athletePixelsPerMeter: number;
    /** Scale from the trampoline bed at its center, NaN when uncalibrated. */
    trampolinePixelsPerMeter: number;
    /** What zero height means: the bed surface (calibrated) or the lowest center-of-mass point of the clip. */
    heightReference: 'bed' | 'lowest point';
    calibrated: boolean;
    calibrationError: string | null;
    /** Angle between the on-screen horizontal and bed side 1→2, degrees. NaN when uncalibrated. */
    viewAngleDeg: number;
    bodyLengthPx: number;
    /** Largest change of body orientation between two consecutive samples, degrees. Above ~120 the count can be ambiguous. */
    maxRotationStepDeg: number;
  };
  time: Float64Array;
  /** Smoothed, gap-filled landmarks in pixels (null where no athlete could be located). Visibility = per-joint score. */
  landmarks: (Keypoint[] | null)[];
  /** Per landmark, per sample: JOINT_STATE code (missing / measured / interpolated / corrected). */
  jointState: Uint8Array[];
  stabilizeStats: StabilizeStats;
  /** Mean visibility of the core landmarks as reported by the model, 0 when not detected. */
  confidence: Float64Array;
  comX: Float64Array; // px
  comY: Float64Array; // px (image coordinates, y down)
  /** Share of body mass whose segments were visible when the COM was computed (COM is dropped below 0.5). */
  comCoverage: Float64Array;
  /** COM height above the reference in `meta.heightReference`, meters. */
  height: Float64Array;
  /** COM vertical velocity, m/s, positive = up. */
  vy: Float64Array;
  /** Horizontal COM position, meters: from the bed center when calibrated, else from the first valid sample. + = right. */
  x: Float64Array;
  /** x divided by the half-size of the bed along the on-screen horizontal: +-1 = bed edge. NaN when uncalibrated. */
  xNorm: Float64Array;
  /** Trunk (hip→shoulder) angle from vertical-up, degrees in (-180, 180], + = clockwise. */
  trunkAngle: Float64Array;
  /** Body-line (ankles→head) angle from vertical-up, same convention. */
  lineAngle: Float64Array;
  /** Continuous body orientation (trunk angle unwrapped): 350 → 355 → 360 → 365, never back to 0. */
  orientation: Float64Array;
  /** Cumulative trunk rotation, degrees, relative to the first valid sample. */
  rotation: Float64Array;
  /** Trunk angular velocity, deg/s. */
  angularVelocity: Float64Array;
  joints: Record<JointName, Float64Array>;
  /** Jump cycles and the per-sample labels derived from them. */
  jumps: JumpAnalysis;
  summary: AnalysisSummary;
}
