import { LM } from '../pose/landmarks';
import { buildCalibration } from './calibration';
import { estimateCom } from './com';
import { angleFromVertical, jointAngle, mid, skeletonLength } from './geometry';
import { detectJumps } from './jumpCycles';
import { localPolyFit, median, oddWindow, unwrapDegrees } from './signal';
import { stabilizePose, type StabilizedPose } from './stabilize';
import {
  DEFAULT_ANALYSIS_OPTIONS,
  JOINT_NAMES,
  type AnalysisOptions,
  type AnalysisResult,
  type JointName,
  type PoseTrack,
  type ScaleSource,
} from './types';

/** Skeleton path length (nose→shoulders→hips→knees→ankles) is about 0.9x standing height. */
const SKELETON_TO_HEIGHT = 0.9;
const VELOCITY_WINDOW_S = 0.2;
/** Below this share of body mass the center of mass is not trusted (e.g. only the legs were seen). */
const MIN_COM_COVERAGE = 0.5;

const nanSeries = (n: number) => new Float64Array(n).fill(NaN);

/** Interior angle definitions: [a, vertex, c]. */
const JOINTS: Record<JointName, [number, number, number]> = {
  leftElbow: [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST],
  rightElbow: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
  leftShoulder: [LM.L_HIP, LM.L_SHOULDER, LM.L_ELBOW],
  rightShoulder: [LM.R_HIP, LM.R_SHOULDER, LM.R_ELBOW],
  leftHip: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE],
  rightHip: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE],
  leftKnee: [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
  rightKnee: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
};

/**
 * Stage 2: stabilize the raw landmarks, then derive COM, height, velocity, horizontal position (relative
 * to the trampoline when calibrated), body orientation, jump cycles and rotation counts.
 * Pass `stabilized` to reuse an earlier `stabilizePose(track)` (it does not depend on the athlete height
 * or the calibration).
 */
export function computeAnalysis(
  track: PoseTrack,
  options: Partial<AnalysisOptions> = {},
  stabilized?: StabilizedPose,
): AnalysisResult {
  const opts = { ...DEFAULT_ANALYSIS_OPTIONS, ...options };
  const n = track.frames.length;
  const fps = track.fps;
  const velWindow = oddWindow(VELOCITY_WINDOW_S, fps);

  // 1. Clean landmarks: gating, glitch rejection, gap filling, confidence-weighted smoothing.
  const stab = stabilized ?? stabilizePose(track, { minVisibility: opts.minVisibility });
  const { landmarks, confidence } = stab;

  // 2. Per-frame geometry.
  const comX = nanSeries(n);
  const comY = nanSeries(n);
  const comCoverage = new Float64Array(n);
  const trunk = nanSeries(n);
  const line = nanSeries(n);
  const skeletonLen = nanSeries(n);
  const joints = Object.fromEntries(JOINT_NAMES.map((j) => [j, nanSeries(n)])) as Record<JointName, Float64Array>;

  for (let i = 0; i < n; i++) {
    const pts = landmarks[i];
    if (!pts) continue;
    const com = estimateCom(pts);
    if (com) {
      comCoverage[i] = com.coverage;
      if (com.coverage >= MIN_COM_COVERAGE) {
        comX[i] = com.x;
        comY[i] = com.y;
      }
    }
    const shoulders = mid(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
    const hips = mid(pts[LM.L_HIP], pts[LM.R_HIP]);
    const ankles = mid(pts[LM.L_ANKLE], pts[LM.R_ANKLE]);
    const head = Number.isFinite(pts[LM.L_EAR].x) && Number.isFinite(pts[LM.R_EAR].x) ? mid(pts[LM.L_EAR], pts[LM.R_EAR]) : pts[LM.NOSE];

    trunk[i] = angleFromVertical(hips, shoulders);
    line[i] = angleFromVertical(ankles, head);
    skeletonLen[i] = skeletonLength(pts);
    for (const name of JOINT_NAMES) {
      const [a, b, c] = JOINTS[name];
      joints[name][i] = jointAngle(pts[a], pts[b], pts[c]);
    }
  }

  // 3. Scale. Athlete: skeleton length vs. the height the user entered. Trampoline: the bed size.
  const athletePixelsPerMeter = median(skeletonLen) / (SKELETON_TO_HEIGHT * opts.athleteHeightM);
  let calibrationError: string | null = null;
  let calibration: ReturnType<typeof buildCalibration> | null = null;
  if (opts.calibration) {
    calibration = buildCalibration(opts.calibration);
    if (!calibration.ok) calibrationError = calibration.error;
  }
  const model = calibration?.ok ? calibration.model : null;
  const trampolinePixelsPerMeter = model ? 1 / model.metersPerPixel : NaN;
  const wanted = opts.scaleSource ?? 'auto';
  const scaleSource: ScaleSource = model && (wanted === 'auto' || wanted === 'trampoline') ? 'trampoline' : 'athlete';
  const pixelsPerMeter = scaleSource === 'trampoline' ? trampolinePixelsPerMeter : athletePixelsPerMeter;

  // 4. Height (up = positive), horizontal position, vertical velocity.
  const height = nanSeries(n);
  const x = nanSeries(n);
  const xNorm = nanSeries(n);
  if (model) {
    for (let i = 0; i < n; i++) {
      height[i] = (model.center.y - comY[i]) / pixelsPerMeter;
      x[i] = (comX[i] - model.center.x) / pixelsPerMeter;
      xNorm[i] = (comX[i] - model.center.x) * model.metersPerPixel / model.halfExtentM;
    }
  } else {
    let lowestY = -Infinity;
    for (let i = 0; i < n; i++) if (Number.isFinite(comY[i])) lowestY = Math.max(lowestY, comY[i]);
    const firstX = comX.find(Number.isFinite) ?? NaN;
    for (let i = 0; i < n; i++) {
      height[i] = (lowestY - comY[i]) / pixelsPerMeter;
      x[i] = (comX[i] - firstX) / pixelsPerMeter;
    }
  }
  const vy = localPolyFit(height, velWindow).slope.map((s) => s * fps);

  // 5. Orientation: the trunk angle made continuous, then differentiated.
  const orientation = unwrapDegrees(trunk);
  const firstOrientation = orientation.find(Number.isFinite) ?? 0;
  const rotation = orientation.map((r) => r - firstOrientation);
  const angularVelocity = localPolyFit(rotation, velWindow).slope.map((s) => s * fps);
  let maxRotationStepDeg = 0;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(orientation[i])) continue;
    if (Number.isFinite(prev) && i > 0 && Number.isFinite(orientation[i - 1])) maxRotationStepDeg = Math.max(maxRotationStepDeg, Math.abs(orientation[i] - prev));
    prev = orientation[i];
  }

  // 6. Jump cycles: takeoff, apex, landing, phases, rotation counts.
  const time = Float64Array.from(track.times);
  const jumps = detectJumps({ fps, time, height, vy, x, orientation });

  // 7. Summary.
  const finite = (a: Float64Array) => Array.from(a).filter(Number.isFinite);
  const heights = finite(height);
  const vels = finite(vy);
  const rot = finite(rotation);
  const summary = {
    maxHeightM: heights.length ? Math.max(...heights) : NaN,
    peakUpVelocity: vels.length ? Math.max(...vels) : NaN,
    peakDownVelocity: vels.length ? Math.min(...vels) : NaN,
    totalRotationDeg: rot.length ? rot[rot.length - 1] : NaN,
    validFraction: n ? finite(comY).length / n : 0,
    jumpCount: jumps.cycles.length,
    completedRotations: jumps.cycles.reduce((s, c) => s + Math.abs(c.completedRotations ?? 0), 0),
  };

  return {
    meta: {
      width: track.width,
      height: track.height,
      fps,
      sourceFps: track.sourceFps,
      count: n,
      backend: track.backend,
      athleteHeightM: opts.athleteHeightM,
      pixelsPerMeter,
      scaleSource,
      athletePixelsPerMeter,
      trampolinePixelsPerMeter,
      heightReference: model ? 'bed' : 'lowest point',
      calibrated: model !== null,
      calibrationError,
      viewAngleDeg: model ? model.viewAngleDeg : NaN,
      bodyLengthPx: stab.bodyLengthPx,
      maxRotationStepDeg,
    },
    time,
    landmarks,
    jointState: stab.state,
    stabilizeStats: stab.stats,
    confidence,
    comX,
    comY,
    comCoverage,
    height,
    vy,
    x,
    xNorm,
    trunkAngle: trunk,
    lineAngle: line,
    orientation,
    rotation,
    angularVelocity,
    joints,
    jumps,
    summary,
  };
}
