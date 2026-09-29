import { CORE_LANDMARKS, LANDMARK_COUNT, LANDMARK_NAMES } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import type { TrampolineCalibration } from './calibration';
import { JUMP_PHASES, type JumpCycle, type JumpPhase } from './jumpCycles';
import { JOINT_STATE_NAMES } from './stabilize';
import type { AnalysisResult, PoseTrack, ScaleSource } from './types';

/**
 * The frame-by-frame store. One `FrameRecord` per analyzed video frame holds everything the app knows
 * about that instant, so the whole clip is a plain, self-describing time series that a temporal model
 * (or any script) can read without touching the UI or the pose backend. The raw model output is kept
 * next to the cleaned data, so the analysis can be re-run later with other settings.
 */
export const SERIES_SCHEMA = 'trampovision.pose-series';
export const SERIES_VERSION = 1;

/** One joint in one frame: [x px, y px, score 0..1, state code (see `stateCodes` in the header)]. */
export type JointTuple = [number, number, number, number];

export interface FrameRecord {
  /** Sample index in this series. */
  index: number;
  /** Video frame number (0-based) this sample was taken from. */
  frame: number;
  /** Timestamp in seconds. */
  t: number;
  /** True when the pose model found the athlete in this frame. */
  detected: boolean;
  /** Mean model visibility of the core joints, 0..1. */
  confidence: number;
  /** All 33 joints after stabilization, in `landmarkNames` order; null when nothing is known. */
  joints: JointTuple[] | null;
  /** Estimated center of mass; null when it could not be estimated. */
  com: {
    xPx: number;
    yPx: number;
    /** Horizontal position in meters (from the bed center when calibrated). */
    xM: number;
    /** Same, divided by the half-size of the bed: +-1 = the edge. Null when uncalibrated. */
    xNorm: number | null;
    heightM: number;
    /** Share of body mass that was visible for this estimate. */
    coverage: number;
    vyMps: number | null;
  } | null;
  /** Body orientation from the trunk (hips → shoulders), degrees, clockwise = + as seen in the video. */
  orientation: {
    /** Wrapped to (-180, 180]. */
    wrappedDeg: number;
    /** Continuous: keeps counting past 360 (350, 355, 360, 365, ...). */
    unwrappedDeg: number;
    angularVelocityDps: number | null;
  } | null;
  phase: JumpPhase;
  /** 0-based jump this frame belongs to (takeoff to landing), else null. */
  jump: number | null;
  /** Turns since the takeoff of the latest jump; null before the first takeoff. */
  turnsSinceTakeoff: number | null;
  completedRotations: number;
}

export interface PoseSeries {
  schema: typeof SERIES_SCHEMA;
  version: number;
  source: {
    fileName: string;
    width: number;
    height: number;
    /** Sampling rate of `frames`, Hz. */
    fps: number;
    sourceFps: number;
    stride: number;
    backend: string;
  };
  settings: {
    athleteHeightM: number;
    scaleSource: ScaleSource;
    minVisibility: number;
  };
  calibration: TrampolineCalibration | null;
  scale: {
    pixelsPerMeter: number | null;
    scaleSource: ScaleSource;
    /** What height 0 means. */
    heightReference: 'bed' | 'lowest point';
  };
  landmarkNames: string[];
  /** Meaning of the state code in each JointTuple. */
  stateCodes: string[];
  frames: FrameRecord[];
  jumps: JumpCycle[];
  /** Raw model output per frame, [x, y, visibility] per landmark (null = nobody detected). Enough to re-run the analysis. */
  raw: ([number, number, number][] | null)[];
}

const r = (v: number, d = 3): number | null => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const rn = (v: number, d = 3): number => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);

export interface SeriesInfo {
  fileName: string;
  stride: number;
  minVisibility: number;
  calibration: TrampolineCalibration | null;
}

/** Builds the storable series from an analysis result and the raw track it came from. */
export function buildPoseSeries(result: AnalysisResult, track: PoseTrack, info: SeriesInfo): PoseSeries {
  const { meta } = result;
  const frames: FrameRecord[] = [];
  for (let i = 0; i < meta.count; i++) {
    const pts = result.landmarks[i];
    const hasCom = Number.isFinite(result.comX[i]) && Number.isFinite(result.comY[i]);
    const hasAngle = Number.isFinite(result.orientation[i]);
    const cycle = result.jumps.cycleIndex[i];
    const turns = result.jumps.turnsSinceTakeoff[i];
    frames.push({
      index: i,
      frame: Math.round(track.times[i] * meta.sourceFps),
      t: rn(result.time[i], 4),
      detected: track.frames[i] !== null,
      confidence: rn(result.confidence[i]),
      joints: pts ? pts.map((p, k) => [rn(p.x, 2), rn(p.y, 2), rn(p.visibility, 2), result.jointState[k][i]] as JointTuple) : null,
      com: hasCom
        ? {
            xPx: rn(result.comX[i], 2),
            yPx: rn(result.comY[i], 2),
            xM: rn(result.x[i]),
            xNorm: r(result.xNorm[i]),
            heightM: rn(result.height[i]),
            coverage: rn(result.comCoverage[i], 2),
            vyMps: r(result.vy[i]),
          }
        : null,
      orientation: hasAngle
        ? {
            wrappedDeg: rn(result.trunkAngle[i], 2),
            unwrappedDeg: rn(result.orientation[i], 2),
            angularVelocityDps: r(result.angularVelocity[i], 1),
          }
        : null,
      phase: JUMP_PHASES[result.jumps.phase[i]],
      jump: cycle >= 0 ? cycle : null,
      turnsSinceTakeoff: r(turns, 3),
      completedRotations: result.jumps.completedRotations[i],
    });
  }
  return {
    schema: SERIES_SCHEMA,
    version: SERIES_VERSION,
    source: {
      fileName: info.fileName,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      sourceFps: meta.sourceFps,
      stride: info.stride,
      backend: meta.backend,
    },
    settings: { athleteHeightM: meta.athleteHeightM, scaleSource: meta.scaleSource, minVisibility: info.minVisibility },
    calibration: info.calibration,
    scale: { pixelsPerMeter: r(meta.pixelsPerMeter, 3), scaleSource: meta.scaleSource, heightReference: meta.heightReference },
    landmarkNames: LANDMARK_NAMES,
    stateCodes: [...JOINT_STATE_NAMES],
    frames,
    jumps: result.jumps.cycles,
    raw: track.frames.map((f) => (f ? f.map((p) => [rn(p.x, 2), rn(p.y, 2), rn(p.visibility, 3)] as [number, number, number]) : null)),
  };
}

export function toSeriesJson(series: PoseSeries): string {
  return JSON.stringify(series);
}

export interface ParsedSeries {
  track: PoseTrack;
  calibration: TrampolineCalibration | null;
  settings: PoseSeries['settings'];
  source: PoseSeries['source'];
}

/** Reads a series JSON back into the raw track and the settings needed to re-run the analysis. Throws a readable Error. */
export function parsePoseSeries(text: string): ParsedSeries {
  let data: Partial<PoseSeries>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || data.schema !== SERIES_SCHEMA) throw new Error('This is not a TrampoVision pose-series file.');
  if (typeof data.version !== 'number' || data.version > SERIES_VERSION) {
    throw new Error(`Unsupported file version (${String(data.version)}); this app reads version ${SERIES_VERSION}.`);
  }
  const { source, raw, frames } = data;
  if (!source || !Array.isArray(raw) || !Array.isArray(frames) || raw.length !== frames.length || frames.length === 0) {
    throw new Error('The file has no frame data.');
  }
  const keypoints = (f: [number, number, number][] | null): Keypoint[] | null => {
    if (f === null) return null;
    if (!Array.isArray(f) || f.length !== LANDMARK_COUNT) throw new Error(`A frame does not have ${LANDMARK_COUNT} landmarks.`);
    return f.map(([x, y, visibility]) => ({ x, y, visibility }));
  };
  const track: PoseTrack = {
    width: source.width,
    height: source.height,
    fps: source.fps,
    sourceFps: source.sourceFps,
    times: frames.map((f) => f.t),
    frames: raw.map(keypoints),
    backend: source.backend,
  };
  return {
    track,
    calibration: data.calibration ?? null,
    settings: data.settings ?? { athleteHeightM: 1.75, scaleSource: 'athlete', minVisibility: 0.4 },
    source,
  };
}

/** Feature matrix for a temporal model: one row per frame, plus a validity mask. */
export interface FeatureMatrix {
  names: string[];
  /** Row-major [frames x features]. Missing values are 0 and flagged in `mask`. */
  data: Float32Array;
  /** 1 when the frame has a usable pose and center of mass. */
  mask: Uint8Array;
  frames: number;
  features: number;
  fps: number;
}

/**
 * Turns the analysis into a fixed-size numeric sequence:
 *  - pose shape: each joint relative to the center of mass, divided by the body length (so it does not
 *    depend on where the athlete is in the image, or how large), 2 numbers per joint;
 *  - joint scores;
 *  - trajectory: height, vertical speed, horizontal position (meters and bed-normalized);
 *  - orientation as sin/cos plus the continuous number of turns and the angular speed.
 * Everything comes from simple geometry; nothing here is learned.
 */
export function buildFeatureMatrix(result: AnalysisResult): FeatureMatrix {
  const n = result.meta.count;
  const body = result.meta.bodyLengthPx;
  const names: string[] = [];
  for (const nm of LANDMARK_NAMES) names.push(`${nm}_dx`, `${nm}_dy`);
  for (const nm of LANDMARK_NAMES) names.push(`${nm}_score`);
  names.push('com_height_m', 'com_vy_mps', 'com_x_m', 'com_x_norm', 'orient_sin', 'orient_cos', 'orient_turns', 'angular_velocity_turns_per_s');
  const F = names.length;
  const data = new Float32Array(n * F);
  const mask = new Uint8Array(n);
  const put = (row: number, col: number, v: number) => {
    data[row * F + col] = Number.isFinite(v) ? v : 0;
  };
  for (let i = 0; i < n; i++) {
    const pts = result.landmarks[i];
    mask[i] =
      pts !== null &&
      CORE_LANDMARKS.every((k) => Number.isFinite(pts[k].x) && Number.isFinite(pts[k].y)) &&
      Number.isFinite(result.comX[i]) &&
      Number.isFinite(result.orientation[i]) &&
      Number.isFinite(body)
        ? 1
        : 0;
    if (pts && Number.isFinite(result.comX[i]) && Number.isFinite(body)) {
      for (let k = 0; k < LANDMARK_COUNT; k++) {
        put(i, 2 * k, (pts[k].x - result.comX[i]) / body);
        put(i, 2 * k + 1, (pts[k].y - result.comY[i]) / body);
      }
    }
    if (pts) for (let k = 0; k < LANDMARK_COUNT; k++) put(i, 2 * LANDMARK_COUNT + k, pts[k].visibility);
    const base = 3 * LANDMARK_COUNT;
    put(i, base, result.height[i]);
    put(i, base + 1, result.vy[i]);
    put(i, base + 2, result.x[i]);
    put(i, base + 3, result.xNorm[i]);
    const rad = (result.orientation[i] * Math.PI) / 180;
    put(i, base + 4, Math.sin(rad));
    put(i, base + 5, Math.cos(rad));
    put(i, base + 6, result.orientation[i] / 360);
    put(i, base + 7, result.angularVelocity[i] / 360);
  }
  return { names, data, mask, frames: n, features: F, fps: result.meta.fps };
}
