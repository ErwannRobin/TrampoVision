import type { Keypoint } from '../pose/types';

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

export interface AnalysisOptions {
  /** Athlete height in meters, used to convert pixels to meters (approximate). */
  athleteHeightM: number;
  /** Landmarks below this visibility are treated as missing and interpolated. */
  minVisibility: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = { athleteHeightM: 1.75, minVisibility: 0.4 };

export interface AnalysisSummary {
  maxHeightM: number;
  peakUpVelocity: number;
  peakDownVelocity: number;
  totalRotationDeg: number;
  validFraction: number;
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
    /** Estimated scale. NaN when it couldn't be estimated (then meter values are NaN). */
    pixelsPerMeter: number;
  };
  time: Float64Array;
  /** Smoothed, gap-filled landmarks in pixels (null where no athlete could be located). */
  landmarks: (Keypoint[] | null)[];
  /** Mean visibility of the core landmarks as reported by the model, 0 when not detected. */
  confidence: Float64Array;
  comX: Float64Array; // px
  comY: Float64Array; // px (image coordinates, y down)
  /** COM height above its lowest point in the clip, meters. */
  height: Float64Array;
  /** COM vertical velocity, m/s, positive = up. */
  vy: Float64Array;
  /** Trunk (hip→shoulder) angle from vertical-up, degrees in (-180, 180], + = clockwise. */
  trunkAngle: Float64Array;
  /** Body-line (ankles→head) angle from vertical-up, same convention. */
  lineAngle: Float64Array;
  /** Cumulative trunk rotation, degrees, relative to the first valid sample. */
  rotation: Float64Array;
  /** Trunk angular velocity, deg/s. */
  angularVelocity: Float64Array;
  joints: Record<JointName, Float64Array>;
  summary: AnalysisSummary;
}
