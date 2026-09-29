import type { JumpCycle } from '../analysis/jumpCycles';
import { median } from '../analysis/signal';
import type { AnalysisResult } from '../analysis/types';
import type { FacingConfig } from './config';
import type { FrameShape } from './frameShape';
import type { FacingEstimate } from './types';

/** Cue weights. Toes are weaker: with pointed toes the foot lies along the shank and says little. */
const WEIGHT = { face: 1, knee: 1, foot: 0.7 };
/** A typical clean detection gives a combined vote near this; confidence reaches 1 there. */
const STRONG_VOTE = 0.6;
/** Facing is read from the bed contact before takeoff as well (feet flat, knees bent), not only from the flight. */
const LEAD_S = 0.35;
const TRAIL_S = 0.1;

interface Score {
  score: number;
  agreement: number;
  cues: FacingEstimate['cues'];
}

function scoreOver(fs: FrameShape, from: number, to: number): Score {
  const collect = (votes: Float64Array) => {
    const v: number[] = [];
    for (let i = Math.max(0, from); i <= Math.min(to, fs.count - 1); i++) if (Number.isFinite(votes[i])) v.push(votes[i]);
    return v.length >= 3 ? median(v) : null;
  };
  const cues = { face: collect(fs.faceVote), knee: collect(fs.kneeVote), foot: collect(fs.footVote) };
  let sum = 0;
  let weights = 0;
  for (const k of ['face', 'knee', 'foot'] as const) {
    const m = cues[k];
    if (m === null) continue;
    sum += WEIGHT[k] * m;
    weights += WEIGHT[k];
  }
  if (weights === 0) return { score: 0, agreement: 0, cues };
  const score = sum / weights;
  let aligned = 0;
  let total = 0;
  for (const k of ['face', 'knee', 'foot'] as const) {
    const m = cues[k];
    if (m === null) continue;
    total += WEIGHT[k] * Math.abs(m);
    if (Math.sign(m) === Math.sign(score)) aligned += WEIGHT[k] * Math.abs(m);
  }
  return { score, agreement: total > 0 ? aligned / total : 0, cues };
}

function sampleRange(result: AnalysisResult, t0: number, t1: number): [number, number] {
  const { time } = result;
  let from = time.length;
  let to = -1;
  for (let i = 0; i < time.length; i++) {
    if (time[i] >= t0 && i < from) from = i;
    if (time[i] <= t1) to = i;
  }
  return [from, to];
}

/**
 * Which way the athlete faces, in the frame of the body: + = toward the right of the image when upright.
 * It only depends on how the body is built, so it stays the same while the athlete somersaults:
 *  - face: nose, eyes and mouth sit in front of the ears (profile view);
 *  - knee: a knee only bends forward, so it lies in front of the hip-ankle line;
 *  - foot: the toes point ahead of the heels when the foot is flat (bed contact).
 * Each cue votes between -1 and 1 per frame; the median over the bed contact and the flight is used.
 * The confidence is the strength of the combined vote times the share of the cues that agree.
 * A manual setting overrides it (confidence 1).
 */
export function estimateFacing(result: AnalysisResult, fs: FrameShape, cycle: JumpCycle, cfg: FacingConfig): FacingEstimate {
  if (cfg.override !== 'auto') {
    return {
      sign: cfg.override === 'right' ? 1 : -1,
      confidence: 1,
      source: 'manual',
      cues: { face: null, knee: null, foot: null },
      agreement: 1,
      twistSuspected: false,
    };
  }
  const t0 = cycle.takeoffTimeS;
  const t1 = cycle.landingTimeS;
  if (t0 === null || t1 === null) {
    return { sign: 0, confidence: 0, source: 'auto', cues: { face: null, knee: null, foot: null }, agreement: 0, twistSuspected: false };
  }
  const [from, to] = sampleRange(result, t0 - LEAD_S, t1 + TRAIL_S);
  const all = scoreOver(fs, from, to);

  // Twist check: the facing seen before the takeoff must match the one seen at the landing.
  const [a0, a1] = sampleRange(result, t0 - LEAD_S, t0 + 0.05);
  const [b0, b1] = sampleRange(result, t1 - 0.15, t1 + TRAIL_S);
  const before = scoreOver(fs, a0, a1);
  const after = scoreOver(fs, b0, b1);
  const twistSuspected = Math.abs(before.score) > 0.3 && Math.abs(after.score) > 0.3 && Math.sign(before.score) !== Math.sign(after.score);

  let confidence = Math.min(1, Math.abs(all.score) / STRONG_VOTE) * all.agreement;
  if (twistSuspected) confidence *= 0.5;
  return {
    sign: confidence >= cfg.minConfidence ? (all.score > 0 ? 1 : -1) : 0,
    confidence,
    source: 'auto',
    cues: all.cues,
    agreement: all.agreement,
    twistSuspected,
  };
}
