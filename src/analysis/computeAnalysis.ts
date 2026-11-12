import { LM } from '../pose/landmarks';
import type { Keypoint, Point } from '../pose/types';
import { bridgeFlightGaps } from './ballistic';
import { buildCalibration } from './calibration';
import { estimateCom } from './com';
import { angleFromVertical, dist, jointAngle, mid, skeletonLength } from './geometry';
import { detectJumps, GRAVITY, PHASE } from './jumpCycles';
import { plainOrientation, trackOrientation } from './orientation';
import { localPolyFit, median, oddWindow, unwrapDegrees, wrapDegrees } from './signal';
import { JOINT_STATE, stabilizePose, type StabilizedPose } from './stabilize';
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
 *
 * The track is read twice when the orientation tracker had to overrule the pose model (see orientation.ts). The first reading tells
 * which frames the model turned over (head where the feet are) and which it read at an angle that has nothing to do with the body.
 * Those frames are then put right in the track itself (`repairTrack`: the first kind turned back about the hips, the second kind
 * dropped) and the track is read again, so that the landmarks, the center of mass and the joint angles are those of the athlete, not
 * only the orientation: a frame left turned over bends the center of mass path and, through the smoothing, the frames next to it.
 */
export function computeAnalysis(
  track: PoseTrack,
  options: Partial<AnalysisOptions> = {},
  stabilized?: StabilizedPose,
): AnalysisResult {
  const first = analyzeTrack(track, options, stabilized);
  const repaired =
    options.repairOrientation === false || options.repairFrames === false
      ? null
      : repairTrack(track, first.result, first.rejected, options.minVisibility);
  if (!repaired) return first.result;
  const second = analyzeTrack(repaired.track, options);
  const n = track.frames.length;
  const flipped = new Uint8Array(n);
  const rejected = new Uint8Array(n);
  let flippedFrames = 0;
  let flipRuns = 0;
  let rejectedFrames = 0;
  for (let i = 0; i < n; i++) {
    flipped[i] = repaired.turned[i] | second.result.orientationFlipped[i];
    rejected[i] = repaired.dropped[i] | second.rejected[i];
    flippedFrames += flipped[i];
    rejectedFrames += rejected[i];
    if (flipped[i] && !(i > 0 && flipped[i - 1])) flipRuns++;
  }
  return {
    ...second.result,
    meta: {
      ...second.result.meta,
      orientationFlippedFrames: flippedFrames,
      orientationFlipRuns: flipRuns,
      orientationRejectedFrames: rejectedFrames,
    },
    // What the model said of each frame, before any frame was dropped.
    confidence: first.result.confidence,
    orientationFlipped: flipped,
    orientationRejected: rejected,
    // The body line stays the one of the first reading: it was made continuous on its own, so it is still an independent check of
    // the trunk's rotation (see skills/rotation.ts). Read again from the repaired track it would only repeat the trunk's verdict.
    lineOrientation: first.result.lineOrientation,
  };
}

/** A raw frame whose own trunk points this far from the orientation the tracker settled on is turned over, degrees. */
const TURNED_OVER_DEG = 130;
/** ... and one this far from it, without being turned over, has nothing to do with the body: it is dropped. */
const UNRELATED_DEG = 60;
/** The body line (ankles to head) has a direction worth reading when it is this long, in body lengths: not in a tuck or a pike. */
const LINE_READABLE = 0.6;

export interface RepairedTrack {
  track: PoseTrack;
  /** 1 for the frames turned back (the whole athlete, or the trunk alone), and for the frames dropped. */
  turned: Uint8Array;
  dropped: Uint8Array;
}

/**
 * The track with the frames the orientation tracker overruled put right, or null when there is nothing to repair. A frame whose
 * angle it left out is dropped (nobody found). A frame it read turned over is turned back, in one of two ways, told apart by the
 * body line (ankles to head):
 *  - the body line is right (read in this frame, long enough to have a direction, and pointing where the trunk really points): only
 *    the hips and the shoulders traded places, and they are traded back;
 *  - else the model read the whole athlete upside down, which is what a pose model does with a body it takes for upright: the whole
 *    skeleton is turned by half a turn about the middle of the hips. That keeps every joint angle, so it is also the safe answer when
 *    the body line does not say (a folded body has none).
 *
 * The tracker only judges the frames whose four trunk joints were measured. The others (a trunk joint with a low score, or thrown out
 * as a glitch) get their orientation from the frames around them, and are judged here against it: in the air, a frame whose own
 * trunk, read from whichever shoulder and hip it has, points the other way is turned over too, and one that points anywhere else is
 * dropped.
 */
export function repairTrack(
  track: PoseTrack,
  result: AnalysisResult,
  rejected: ArrayLike<number>,
  minVisibility = DEFAULT_ANALYSIS_OPTIONS.minVisibility,
): RepairedTrack | null {
  let any = false;
  const turned = new Uint8Array(track.frames.length);
  const dropped = new Uint8Array(track.frames.length);
  const seen = (p: Keypoint) => p.visibility >= minVisibility && Number.isFinite(p.x) && Number.isFinite(p.y);
  const either = (a: Keypoint, b: Keypoint) => (seen(a) && seen(b) ? mid(a, b) : seen(a) ? a : seen(b) ? b : null);
  const body = result.meta.bodyLengthPx;
  /**
   * True when the body line of a frame is read, long enough to have a direction, and points where the trunk really points (the
   * orientation the tracker settled on): a stretched body whose head and feet the model has right.
   */
  const lineIsRight = (f: Keypoint[], i: number): boolean => {
    const ankles = either(f[LM.L_ANKLE], f[LM.R_ANKLE]);
    const head = either(f[LM.L_EAR], f[LM.R_EAR]) ?? (seen(f[LM.NOSE]) ? f[LM.NOSE] : null);
    if (!ankles || !head || !(dist(ankles, head) > LINE_READABLE * body)) return false;
    return Math.abs(wrapDegrees(angleFromVertical(ankles, head) - result.orientation[i])) < UNRELATED_DEG;
  };
  const frames = track.frames.map((f, i) => {
    if (!f) return f;
    if (rejected[i]) {
      any = true;
      dropped[i] = 1;
      return null;
    }
    let turnedOver = result.orientationFlipped[i] === 1;
    const phase = result.jumps.phase[i];
    if (!turnedOver && phase !== PHASE.ground && phase !== PHASE.unknown && Number.isFinite(result.orientation[i])) {
      const hips = either(f[LM.L_HIP], f[LM.R_HIP]);
      const shoulders = either(f[LM.L_SHOULDER], f[LM.R_SHOULDER]);
      if (hips && shoulders && dist(hips, shoulders) > 0.02 * body) {
        const off = Math.abs(wrapDegrees(angleFromVertical(hips, shoulders) - result.orientation[i]));
        turnedOver = off > TURNED_OVER_DEG;
        if (!turnedOver && off > UNRELATED_DEG) {
          any = true;
          dropped[i] = 1;
          return null;
        }
      }
    }
    if (!turnedOver) return f;
    any = true;
    turned[i] = 1;
    if (lineIsRight(f, i)) {
      const out = f.slice();
      out[LM.L_SHOULDER] = f[LM.L_HIP];
      out[LM.L_HIP] = f[LM.L_SHOULDER];
      out[LM.R_SHOULDER] = f[LM.R_HIP];
      out[LM.R_HIP] = f[LM.R_SHOULDER];
      return out;
    }
    const cx = (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2;
    const cy = (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2;
    return f.map((p) => ({ ...p, x: 2 * cx - p.x, y: 2 * cy - p.y }));
  });
  return any ? { track: { ...track, frames }, turned, dropped } : null;
}

function analyzeTrack(
  track: PoseTrack,
  options: Partial<AnalysisOptions>,
  stabilized?: StabilizedPose,
): { result: AnalysisResult; rejected: Uint8Array } {
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
  // What the orientation tracker needs to tell a real rotation from a head/feet flip of the pose model (see orientation.ts).
  const headDir = nanSeries(n);
  const trunkLen = nanSeries(n);
  const trunkTrust = nanSeries(n);
  const lineWeight = nanSeries(n);
  const headWeight = nanSeries(n);
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
    const head =
      Number.isFinite(pts[LM.L_EAR].x) && Number.isFinite(pts[LM.R_EAR].x)
        ? mid(pts[LM.L_EAR], pts[LM.R_EAR])
        : pts[LM.NOSE];

    trunk[i] = angleFromVertical(hips, shoulders);
    line[i] = angleFromVertical(ankles, head);
    trunkLen[i] = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
    trunkTrust[i] =
      (pts[LM.L_SHOULDER].visibility +
        pts[LM.R_SHOULDER].visibility +
        pts[LM.L_HIP].visibility +
        pts[LM.R_HIP].visibility) /
      4;
    if (Number.isFinite(comX[i]) && Number.isFinite(comY[i]) && Number.isFinite(head.x))
      headDir[i] = angleFromVertical({ x: comX[i], y: comY[i] }, head);
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

  // 3b. The athlete lost in mid-flight: the center of mass is still on the parabola of the flight (see ballistic.ts). Without it
  // a hole at the top of a flight hides the apex and the jump is not found.
  const measuredFrames = comY.reduce((s, v) => s + (Number.isFinite(v) ? 1 : 0), 0);
  const flightBridge = bridgeFlightGaps({
    x: comX,
    y: comY,
    fps,
    gravityPx: GRAVITY * athletePixelsPerMeter,
    bodyLengthPx: median(skeletonLen),
  });
  comX.set(flightBridge.x);
  comY.set(flightBridge.y);

  // 4. Height (up = positive), horizontal position, vertical velocity.
  const height = nanSeries(n);
  const x = nanSeries(n);
  const xNorm = nanSeries(n);
  if (model) {
    for (let i = 0; i < n; i++) {
      height[i] = (model.center.y - comY[i]) / pixelsPerMeter;
      x[i] = (comX[i] - model.center.x) / pixelsPerMeter;
      xNorm[i] = ((comX[i] - model.center.x) * model.metersPerPixel) / model.halfExtentM;
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

  // 5. Orientation: the trunk angle made continuous, then differentiated. A trunk that the pose model turned upside down for a few
  // frames is put back by the orientation tracker (it costs nothing on a clean track); `repairOrientation: false` unwraps as it comes.
  const medTrunk = median(trunkLen);
  const bodyLen = median(skeletonLen);
  for (let i = 0; i < n; i++) {
    // A trunk that looks much shorter than usual is foreshortened or collapsed: its angle is not worth much.
    const lengthTrust = Number.isFinite(medTrunk) && medTrunk > 0 ? Math.min(1, trunkLen[i] / (0.7 * medTrunk)) : 1;
    trunkTrust[i] = Math.min(1, trunkTrust[i] * 1.25) * lengthTrust;
    // The ankles-to-head line says little when the legs are folded up to the head, the center-of-mass-to-head direction when the head is tucked in.
    const pts = landmarks[i];
    if (pts && Number.isFinite(bodyLen)) {
      const ankles = mid(pts[LM.L_ANKLE], pts[LM.R_ANKLE]);
      const head =
        Number.isFinite(pts[LM.L_EAR].x) && Number.isFinite(pts[LM.R_EAR].x)
          ? mid(pts[LM.L_EAR], pts[LM.R_EAR])
          : pts[LM.NOSE];
      lineWeight[i] = Math.min(1, Math.hypot(head.x - ankles.x, head.y - ankles.y) / (0.7 * bodyLen));
      headWeight[i] = Number.isFinite(comX[i])
        ? Math.min(1, Math.hypot(head.x - comX[i], head.y - comY[i]) / (0.3 * bodyLen))
        : 0;
    }
  }
  // A joint that was bridged (across a gap, or in place of a rejected glitch) is not a measurement: between two sightings a bridged
  // joint goes the short way round, so a body that turned more than half a turn while it was lost would be read as having turned
  // back. The angle of such a frame is left to the orientation tracker, which bridges a gap with the rate of turn on both sides of it.
  const madeUp = (i: number, ks: number[]) => ks.every((k) => stab.state[k][i] !== JOINT_STATE.measured);
  // The trunk has a direction of its own as long as one shoulder and one hip were measured: it is then read from the measured ones
  // alone (the left and the right joint are a pair: one of them is enough, and a bridged partner would only pull it off).
  const trunkMadeUp = new Uint8Array(n);
  const lineMadeUp = new Uint8Array(n);
  const trackedTrunk = Float64Array.from(trunk);
  const measuredMid = (i: number, a: number, b: number): Point | null => {
    const pts = landmarks[i];
    if (!pts) return null;
    const ma = stab.state[a][i] === JOINT_STATE.measured;
    const mb = stab.state[b][i] === JOINT_STATE.measured;
    return ma && mb ? mid(pts[a], pts[b]) : ma ? pts[a] : mb ? pts[b] : null;
  };
  for (let i = 0; i < n; i++) {
    const shoulders = measuredMid(i, LM.L_SHOULDER, LM.R_SHOULDER);
    const hips = measuredMid(i, LM.L_HIP, LM.R_HIP);
    trunkMadeUp[i] = shoulders && hips ? 0 : 1;
    if (shoulders && hips && Number.isFinite(trunk[i])) trackedTrunk[i] = angleFromVertical(hips, shoulders);
    lineMadeUp[i] = trunkMadeUp[i] || madeUp(i, [LM.L_ANKLE, LM.R_ANKLE]) || madeUp(i, [LM.NOSE]) ? 1 : 0;
  }
  // The flights, found a first time on the orientation as measured: only there can the trunk have been turned over by the pose model.
  const tracked = (() => {
    if (opts.repairOrientation === false) return null;
    const first = detectJumps({
      fps,
      time: Float64Array.from(track.times),
      height,
      vy,
      x,
      orientation: unwrapDegrees(trunk),
    });
    const inFlight = Uint8Array.from(first.phase, (p) => (p === PHASE.ground || p === PHASE.unknown ? 0 : 1));
    return {
      trunk: trackOrientation({
        angle: trackedTrunk,
        ignore: trunkMadeUp,
        allowFlip: inFlight,
        weight: trunkTrust,
        line,
        lineWeight,
        head: headDir,
        headWeight,
      }),
      line: trackOrientation({ angle: line, ignore: lineMadeUp, allowFlip: inFlight, weight: lineWeight }),
    };
  })();
  const trunkTrack = tracked?.trunk ?? plainOrientation(trunk);
  const orientation = trunkTrack.orientation;
  // The body line is made continuous the same way, on its own: it is the independent check of the trunk's rotation (see skills/rotation.ts).
  const lineOrientation = (tracked?.line ?? plainOrientation(line)).orientation;
  const firstOrientation = orientation.find(Number.isFinite) ?? 0;
  const rotation = orientation.map((r) => r - firstOrientation);
  const angularVelocity = localPolyFit(rotation, velWindow).slope.map((s) => s * fps);
  let maxRotationStepDeg = 0;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(orientation[i])) continue;
    if (Number.isFinite(prev) && i > 0 && Number.isFinite(orientation[i - 1]))
      maxRotationStepDeg = Math.max(maxRotationStepDeg, Math.abs(orientation[i] - prev));
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
    // Frames where the athlete was seen: a center of mass put on the parabola of a flight is not a sighting.
    validFraction: n ? measuredFrames / n : 0,
    jumpCount: jumps.cycles.length,
    completedRotations: jumps.cycles.reduce((s, c) => s + Math.abs(c.completedRotations ?? 0), 0),
  };

  const result: AnalysisResult = {
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
      orientationFlippedFrames: trunkTrack.flippedFrames,
      orientationFlipRuns: trunkTrack.flipRuns,
      orientationRejectedFrames: trunkTrack.rejectedFrames,
    },
    time,
    landmarks,
    jointState: stab.state,
    stabilizeStats: stab.stats,
    confidence,
    comX,
    comY,
    comCoverage,
    comBridged: flightBridge.bridged,
    height,
    vy,
    x,
    xNorm,
    trunkAngle: trunk,
    lineAngle: line,
    orientation,
    orientationFlipped: trunkTrack.flipped,
    orientationRejected: trunkTrack.rejected,
    lineOrientation,
    rotation,
    angularVelocity,
    joints,
    jumps,
    summary,
  };
  return { result, rejected: trunkTrack.rejected };
}
