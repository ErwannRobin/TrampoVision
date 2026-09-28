import { CORE_LANDMARKS, LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { estimateCom } from './com';
import { angleFromVertical, dist, jointAngle, mid } from './geometry';
import { fillGaps, localPolyFit, median, oddWindow, unwrapDegrees } from './signal';
import {
  DEFAULT_ANALYSIS_OPTIONS,
  JOINT_NAMES,
  type AnalysisOptions,
  type AnalysisResult,
  type JointName,
  type PoseTrack,
} from './types';

/** Skeleton path length (nose→shoulders→hips→knees→ankles) is about 0.9x standing height. */
const SKELETON_TO_HEIGHT = 0.9;
const LANDMARK_SMOOTH_S = 0.15;
const VELOCITY_WINDOW_S = 0.2;
const MAX_GAP_S = 0.3;

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

/** Stage 2: clean the raw landmarks, then derive COM, kinematics, angles and rotation. */
export function computeAnalysis(track: PoseTrack, options: Partial<AnalysisOptions> = {}): AnalysisResult {
  const opts = { ...DEFAULT_ANALYSIS_OPTIONS, ...options };
  const n = track.frames.length;
  const fps = track.fps;
  const maxGap = Math.max(1, Math.round(MAX_GAP_S * fps));
  const lmWindow = oddWindow(LANDMARK_SMOOTH_S, fps);
  const velWindow = oddWindow(VELOCITY_WINDOW_S, fps);

  // 1. Per-landmark x/y series: drop low-visibility points, fill short gaps, smooth.
  const xs: Float64Array[] = [];
  const ys: Float64Array[] = [];
  const rawVis: Float64Array[] = [];
  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const x = nanSeries(n);
    const y = nanSeries(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const kp = track.frames[i]?.[k];
      if (!kp) continue;
      v[i] = kp.visibility;
      if (kp.visibility >= opts.minVisibility) {
        x[i] = kp.x;
        y[i] = kp.y;
      }
    }
    xs.push(localPolyFit(fillGaps(x, maxGap), lmWindow).value);
    ys.push(localPolyFit(fillGaps(y, maxGap), lmWindow).value);
    rawVis.push(v);
  }

  const landmarks: (Keypoint[] | null)[] = [];
  const confidence = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let anyFinite = false;
    const pts: Keypoint[] = [];
    for (let k = 0; k < LANDMARK_COUNT; k++) {
      if (Number.isFinite(xs[k][i]) && Number.isFinite(ys[k][i])) anyFinite = true;
      pts.push({ x: xs[k][i], y: ys[k][i], visibility: rawVis[k][i] });
    }
    landmarks.push(anyFinite ? pts : null);
    confidence[i] = track.frames[i] ? CORE_LANDMARKS.reduce((s, k) => s + rawVis[k][i], 0) / CORE_LANDMARKS.length : 0;
  }

  // 2. Per-frame geometry.
  const comX = nanSeries(n);
  const comY = nanSeries(n);
  const trunk = nanSeries(n);
  const line = nanSeries(n);
  const skeletonLen = nanSeries(n);
  const joints = Object.fromEntries(JOINT_NAMES.map((j) => [j, nanSeries(n)])) as Record<JointName, Float64Array>;

  for (let i = 0; i < n; i++) {
    const pts = landmarks[i];
    if (!pts) continue;
    const com = estimateCom(pts);
    if (com) {
      comX[i] = com.x;
      comY[i] = com.y;
    }
    const shoulders = mid(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
    const hips = mid(pts[LM.L_HIP], pts[LM.R_HIP]);
    const knees = mid(pts[LM.L_KNEE], pts[LM.R_KNEE]);
    const ankles = mid(pts[LM.L_ANKLE], pts[LM.R_ANKLE]);
    const head = Number.isFinite(pts[LM.L_EAR].x) && Number.isFinite(pts[LM.R_EAR].x) ? mid(pts[LM.L_EAR], pts[LM.R_EAR]) : pts[LM.NOSE];

    trunk[i] = angleFromVertical(hips, shoulders);
    line[i] = angleFromVertical(ankles, head);
    skeletonLen[i] = dist(pts[LM.NOSE], shoulders) + dist(shoulders, hips) + dist(hips, knees) + dist(knees, ankles);
    for (const name of JOINT_NAMES) {
      const [a, b, c] = JOINTS[name];
      joints[name][i] = jointAngle(pts[a], pts[b], pts[c]);
    }
  }

  // 3. Scale: pixels per meter from the median skeleton length and the athlete's height.
  const pixelsPerMeter = median(skeletonLen) / (SKELETON_TO_HEIGHT * opts.athleteHeightM);

  // 4. Vertical position / velocity (up = positive), relative to the lowest COM point.
  let lowestY = -Infinity;
  for (let i = 0; i < n; i++) if (Number.isFinite(comY[i])) lowestY = Math.max(lowestY, comY[i]);
  const height = nanSeries(n);
  for (let i = 0; i < n; i++) height[i] = (lowestY - comY[i]) / pixelsPerMeter;
  const vy = localPolyFit(height, velWindow).slope.map((s) => s * fps);

  // 5. Rotation: unwrap the trunk angle, then differentiate.
  const rotationAbs = unwrapDegrees(trunk);
  const first = rotationAbs.find(Number.isFinite) ?? 0;
  const rotation = rotationAbs.map((r) => r - first);
  const angularVelocity = localPolyFit(rotation, velWindow).slope.map((s) => s * fps);

  // 6. Summary.
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
    },
    time: Float64Array.from(track.times),
    landmarks,
    confidence,
    comX,
    comY,
    height,
    vy,
    trunkAngle: trunk,
    lineAngle: line,
    rotation,
    angularVelocity,
    joints,
    summary,
  };
}
