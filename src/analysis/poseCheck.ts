import { LM } from '../pose/landmarks';
import { mergeSkillConfig, type SkillConfig } from '../skills/config';
import { computeFrameShape } from '../skills/frameShape';
import { estimateRotation } from '../skills/rotation';
import { JOINT_STATE } from './stabilize';
import type { AnalysisResult, PoseTrack } from './types';

/**
 * How well the pose model read the athlete, without labels: the frames where its reading cannot be trusted, and which of them a
 * second, slower model should read again (see fusion.ts). A flight is doubtful when the athlete was not measured through it, when
 * the orientation tracker had to turn a reading over (head where the feet are), when the rotation fails the checks the classifier
 * uses (it went one way and came back, it jumped between two frames, the body line did not turn with the trunk), when the joints
 * were read with little confidence, or when the athlete rotates at all: on the sample clips MediaPipe read 1 of 5 and 0 of 4
 * somersaults cleanly where RTMPose-m read 5 of 5 and 3 of 5 (eval-consistency, first four checks), so a rotating flight is
 * doubtful by itself. Frames where the athlete was lost near frames where they were seen are read again too: the second model may
 * find them there.
 */

export type Doubt = 'missing' | 'flipped' | 'reversal' | 'step' | 'crossCheck' | 'confidence' | 'rotating';
export const DOUBTS: readonly Doubt[] = [
  'missing',
  'flipped',
  'reversal',
  'step',
  'crossCheck',
  'confidence',
  'rotating',
];

export interface PoseCheckOptions {
  /** A flight whose trunk joints were measured (not bridged, not missing) in less than this share of its frames is doubtful. */
  minCoverage: number;
  /** ... or whose core joints were read below this mean score. */
  minConfidence: number;
  /** ... or that rotates more than this (net or along the way), degrees. Infinity: rotation alone is not a doubt. */
  rotatingDeg: number;
  /** The body line may turn this much more or less than the trunk (the consistency check's limit). */
  crossCheckDeg: number;
  /** Frames read again before the takeoff and after the landing of a doubtful flight, seconds: the merge needs a few sure frames around. */
  padS: number;
  /** Frames without the athlete closer than this to a frame with the athlete are read again, seconds. */
  lostReachS: number;
  config: SkillConfig;
}

export const DEFAULT_POSE_CHECK_OPTIONS: PoseCheckOptions = {
  minCoverage: 0.9,
  minConfidence: 0.6,
  rotatingDeg: 90,
  crossCheckDeg: 60,
  padS: 0.2,
  lostReachS: 1,
  config: mergeSkillConfig(),
};

export interface FlightCheck {
  /** The jump's index in `result.jumps.cycles`. */
  jump: number;
  from: number;
  to: number;
  /** Share of the flight's frames with the four trunk joints measured. */
  coverage: number;
  /** Mean score of the core joints over the flight. */
  confidence: number;
  turns: number | null;
  doubts: Doubt[];
}

export interface PoseCheck {
  /** 1 for the frames to read again. */
  frames: Uint8Array;
  flights: FlightCheck[];
  /** Frames without the athlete that are read again (near frames with the athlete). */
  lostFrames: number;
  /** Frames to read again, in all. */
  count: number;
}

const TRUNK = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

function mark(frames: Uint8Array, from: number, to: number): void {
  for (let i = Math.max(0, from); i <= Math.min(frames.length - 1, to); i++) frames[i] = 1;
}

/** Checks the reading of one athlete (`result` is `computeAnalysis(track)`). */
export function checkPose(
  track: PoseTrack,
  result: AnalysisResult,
  options: Partial<PoseCheckOptions> = {},
): PoseCheck {
  const o = { ...DEFAULT_POSE_CHECK_OPTIONS, ...options };
  const n = track.frames.length;
  const fps = track.fps;
  const pad = Math.round(o.padS * fps);
  const frames = new Uint8Array(n);
  const shape = computeFrameShape(result, o.config);
  const measured = (i: number) => TRUNK.every((k) => result.jointState[k][i] === JOINT_STATE.measured);

  const flights: FlightCheck[] = [];
  result.jumps.cycles.forEach((cycle, jump) => {
    // A flight cut by the clip is read from its first frame, or to its last one.
    const from = cycle.takeoff ?? 0;
    const to = cycle.landing ?? n - 1;
    if (to < from) return;
    let seen = 0;
    let score = 0;
    let flipped = 0;
    let path = 0;
    for (let i = from; i <= to; i++) {
      if (measured(i)) seen++;
      score += result.confidence[i];
      flipped += result.orientationFlipped[i];
      if (i > from && Number.isFinite(result.orientation[i]) && Number.isFinite(result.orientation[i - 1]))
        path += Math.abs(result.orientation[i] - result.orientation[i - 1]);
    }
    const count = to - from + 1;
    const coverage = seen / count;
    const confidence = score / count;
    const rotation = estimateRotation(result, shape, cycle, o.config.rotation);
    const net = rotation.totalDeg ?? cycle.rotationDeg ?? NaN;
    const doubts: Doubt[] = [];
    if (coverage < o.minCoverage) doubts.push('missing');
    if (flipped > 0) doubts.push('flipped');
    if (rotation.reversalDeg !== null && rotation.reversalDeg > o.config.rotation.reversalOkDeg)
      doubts.push('reversal');
    if (rotation.maxStepDeg !== null && rotation.maxStepDeg > o.config.rotation.maxStepDeg) doubts.push('step');
    if (rotation.crossCheckDiffDeg !== null && Math.abs(rotation.crossCheckDiffDeg) > o.crossCheckDeg)
      doubts.push('crossCheck');
    if (confidence < o.minConfidence) doubts.push('confidence');
    if (Math.abs(net) > o.rotatingDeg || path > o.rotatingDeg) doubts.push('rotating');
    if (doubts.length) mark(frames, from - pad, to + pad);
    flights.push({ jump, from, to, coverage, confidence, turns: Number.isFinite(net) ? net / 360 : null, doubts });
  });

  // The athlete lost: frames with nobody, within reach of a frame with them.
  const reach = Math.round(o.lostReachS * fps);
  const lastSeen = new Int32Array(n);
  const nextSeen = new Int32Array(n);
  let at = -Infinity;
  for (let i = 0; i < n; i++) {
    if (track.frames[i]) at = i;
    lastSeen[i] = Number.isFinite(at) ? at : -1;
  }
  at = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (track.frames[i]) at = i;
    nextSeen[i] = Number.isFinite(at) ? at : -1;
  }
  let lostFrames = 0;
  for (let i = 0; i < n; i++) {
    if (track.frames[i]) continue;
    const near = (lastSeen[i] >= 0 && i - lastSeen[i] <= reach) || (nextSeen[i] >= 0 && nextSeen[i] - i <= reach);
    if (!near) continue;
    frames[i] = 1;
    lostFrames++;
  }

  let count = 0;
  for (let i = 0; i < n; i++) count += frames[i];
  return { frames, flights, lostFrames, count };
}
