import { computeAnalysis } from '../analysis/computeAnalysis';
import { makeRng } from '../analysis/testTracks';
import type { PoseTrack } from '../analysis/types';
import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { analyzeSkills } from './analyzeSkills';
import type { DeepPartial, SkillConfig } from './config';
import { degradeTrack, mannequinRoutine, type MannequinJump, type MannequinShape } from './testMannequin';
import type { SkillId } from './types';

/**
 * Synthetic evaluation harness (test support, not used by the app): random athletes and jumps with known
 * labels, optional degradations, and a confusion matrix. It answers one narrow question: if the pose
 * estimator were as good as this simulated one, do the extracted features separate the skills?
 * It says nothing about how a real pose model behaves on real trampoline footage.
 */

export const TRUTH_CLASSES = ['straight-jump', 'tuck-jump', 'pike-jump', 'back', 'front'] as const;
export type TruthClass = (typeof TRUTH_CLASSES)[number];

export type FlipMode = 'none' | 'mirror' | 'rotate180';

export interface Condition {
  name: string;
  /** Landmark jitter, uniform +-, as a fraction of the athlete's height. */
  noise: number;
  /** Probability that a landmark is reported with low visibility (dropped) in a frame. */
  dropout: number;
  /** Simulated pose-model failure on an inverted athlete. */
  flip: FlipMode;
  /** Camera yaw away from side-on, degrees (0 = side view, 90 = seen from the front): horizontal distances shrink by cos(yaw). */
  yawDeg?: number;
}

/** Views the motion plane from an angle: image x is scaled about a fixed vertical axis (the start position of the athlete). */
export function yawView(track: PoseTrack, yawDeg: number): PoseTrack {
  if (!yawDeg) return track;
  const k = Math.cos((yawDeg * Math.PI) / 180);
  const first = track.frames.find((f): f is Keypoint[] => f !== null);
  if (!first) return track;
  const axis = (first[LM.L_HIP].x + first[LM.R_HIP].x) / 2;
  return { ...track, frames: track.frames.map((f) => f && f.map((p) => ({ ...p, x: axis + (p.x - axis) * k }))) };
}

const range = (rnd: () => number, lo: number, hi: number) => lo + ((rnd() + 1) / 2) * (hi - lo);
const pick = <T,>(rnd: () => number, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(((rnd() + 1) / 2) * items.length))];

/** 'textbook' = clean positions; 'sloppy' = loose tucks, bent-knee pikes, slightly piked layouts, so the classes overlap. */
export type Execution = 'textbook' | 'sloppy';

/** Random joint angles for a position. The label is the intended position, however well it is executed. */
function randomShape(rnd: () => number, kind: 'straight' | 'tuck' | 'pike', execution: Execution): MannequinShape {
  const arms = { armDeg: range(rnd, 20, 170), elbowDeg: range(rnd, 0, 40), pointedToes: range(rnd, 0.3, 1) };
  const sloppy = execution === 'sloppy';
  if (kind === 'straight') return { hipFlexDeg: range(rnd, 0, sloppy ? 35 : 15), kneeFlexDeg: range(rnd, 0, sloppy ? 25 : 10), ...arms };
  if (kind === 'tuck') return { hipFlexDeg: range(rnd, sloppy ? 70 : 100, 150), kneeFlexDeg: range(rnd, sloppy ? 50 : 80, 130), ...arms };
  return { hipFlexDeg: range(rnd, sloppy ? 55 : 75, 125), kneeFlexDeg: range(rnd, 0, sloppy ? 35 : 12), ...arms };
}

export function randomJump(rnd: () => number, truth: TruthClass, execution: Execution = 'textbook'): MannequinJump {
  const facing = rnd() < 0 ? -1 : 1;
  const base = {
    v0: range(rnd, 3.8, 5.0),
    facing: facing as 1 | -1,
    closeBy: range(rnd, 0.25, 0.4),
    openFrom: range(rnd, 0.65, 0.8),
  };
  if (truth === 'straight-jump') return { ...base, shape: randomShape(rnd, 'straight', execution) };
  if (truth === 'tuck-jump') return { ...base, shape: randomShape(rnd, 'tuck', execution) };
  if (truth === 'pike-jump') return { ...base, shape: randomShape(rnd, 'pike', execution) };
  // Somersault: front = the top of the body moves toward the face. Facing right + clockwise = front.
  const turns = range(rnd, 0.92, 1.08);
  const clockwise = truth === 'front' ? facing > 0 : facing < 0;
  return { ...base, turns: clockwise ? turns : -turns, shape: randomShape(rnd, pick(rnd, ['straight', 'tuck', 'pike'] as const), execution) };
}

function trunkAngle(f: Keypoint[]): number {
  const sx = (f[LM.L_SHOULDER].x + f[LM.R_SHOULDER].x) / 2;
  const sy = (f[LM.L_SHOULDER].y + f[LM.R_SHOULDER].y) / 2;
  const hx = (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2;
  const hy = (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2;
  return (Math.atan2(sx - hx, -(sy - hy)) * 180) / Math.PI;
}

/**
 * Simulates a pose model that "insists" the athlete is upright when they are inverted (|trunk angle| > 120°):
 *  - mirror:    the skeleton is reflected about the hip line, so it looks upright but the body is wrong;
 *  - rotate180: the skeleton is rotated 180° about the hips, the classic head/feet swap.
 * This is an assumption about a failure mode, not something measured on real footage.
 */
export function flipInverted(track: PoseTrack, mode: FlipMode): PoseTrack {
  if (mode === 'none') return track;
  return {
    ...track,
    frames: track.frames.map((f) => {
      if (!f || Math.abs(trunkAngle(f)) <= 120) return f;
      const hx = (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2;
      const hy = (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2;
      return f.map((p) =>
        mode === 'mirror'
          ? { ...p, y: 2 * hy - p.y }
          : { ...p, x: 2 * hx - p.x, y: 2 * hy - p.y },
      );
    }),
  };
}

export interface EvalRow {
  truth: TruthClass;
  predicted: SkillId;
  confidence: number;
  correct: boolean;
}

export interface EvalSummary {
  condition: Condition;
  rows: EvalRow[];
  /** matrix[truth][predicted] = count. */
  matrix: Record<TruthClass, Partial<Record<SkillId, number>>>;
  n: number;
  /** Correct / all jumps. */
  accuracy: number;
  /** Jumps where the classifier declined (unclassified, or a somersault of unknown direction). */
  abstained: number;
  /** Correct / jumps it answered (excludes abstentions). */
  accuracyWhenAnswered: number;
  /** Wrong answers given with confidence >= 0.6. */
  confidentWrong: number;
  meanConfidenceCorrect: number;
  meanConfidenceWrong: number;
  missedJumps: number;
}

export function evaluate(
  condition: Condition,
  options: { routines?: number; seed?: number; config?: DeepPartial<SkillConfig>; fps?: number; execution?: Execution } = {},
): EvalSummary {
  const rnd = makeRng(options.seed ?? 11);
  const rows: EvalRow[] = [];
  let missed = 0;
  const routines = options.routines ?? 30;
  for (let r = 0; r < routines; r++) {
    // One jump of every class per routine, in random order, so the classes stay balanced.
    const order = [...TRUTH_CLASSES].sort(() => rnd());
    const jumps = order.map((c) => randomJump(rnd, c, options.execution));
    const heightM = range(rnd, 1.55, 1.95);
    const pxPerM = range(rnd, 70, 130);
    const { track } = mannequinRoutine({ jumps, heightM, pxPerM, fps: options.fps ?? 30 });
    const degraded = degradeTrack(flipInverted(yawView(track, condition.yawDeg ?? 0), condition.flip), {
      noisePx: condition.noise * heightM * pxPerM,
      dropout: condition.dropout,
      seed: 1000 + r,
    });
    const result = computeAnalysis(degraded, { athleteHeightM: heightM });
    const skills = analyzeSkills(result, { config: options.config });
    if (skills.jumps.length !== order.length) missed += Math.abs(order.length - skills.jumps.length);
    order.forEach((truth, k) => {
      const j = skills.jumps[k];
      if (!j || skills.jumps.length !== order.length) return;
      const predicted = j.prediction.skill;
      rows.push({ truth, predicted, confidence: j.prediction.confidence, correct: predicted === truth });
    });
  }
  const matrix = Object.fromEntries(TRUTH_CLASSES.map((c) => [c, {}])) as EvalSummary['matrix'];
  for (const row of rows) matrix[row.truth][row.predicted] = (matrix[row.truth][row.predicted] ?? 0) + 1;
  const abstain = (p: SkillId) => p === 'unclassified' || p === 'somersault-direction-unknown';
  const answered = rows.filter((r) => !abstain(r.predicted));
  const correct = rows.filter((r) => r.correct);
  const wrong = rows.filter((r) => !r.correct && !abstain(r.predicted));
  const mean = (a: EvalRow[]) => (a.length ? a.reduce((s, r) => s + r.confidence, 0) / a.length : NaN);
  return {
    condition,
    rows,
    matrix,
    n: rows.length,
    accuracy: rows.length ? correct.length / rows.length : NaN,
    abstained: rows.length - answered.length,
    accuracyWhenAnswered: answered.length ? answered.filter((r) => r.correct).length / answered.length : NaN,
    confidentWrong: wrong.filter((r) => r.confidence >= 0.6).length,
    meanConfidenceCorrect: mean(correct),
    meanConfidenceWrong: mean(wrong),
    missedJumps: missed,
  };
}

/** A compact text table of one summary, for the README and test logs. */
export function formatSummary(s: EvalSummary): string {
  const cols: SkillId[] = ['straight-jump', 'tuck-jump', 'pike-jump', 'back', 'front', 'somersault-direction-unknown', 'unclassified'];
  const short: Record<string, string> = { 'straight-jump': 'straight', 'tuck-jump': 'tuck', 'pike-jump': 'pike', back: 'back', front: 'front', 'somersault-direction-unknown': 'dir?', unclassified: 'none' };
  const lines = [`${s.condition.name}: n=${s.n} accuracy ${(s.accuracy * 100).toFixed(0)}%, answered-correct ${(s.accuracyWhenAnswered * 100).toFixed(0)}%, abstained ${s.abstained}, confident-wrong ${s.confidentWrong}, missed jumps ${s.missedJumps}`];
  lines.push(['truth \\ predicted', ...cols.map((c) => short[c])].map((x) => x.padEnd(10)).join(''));
  for (const t of TRUTH_CLASSES) lines.push([t, ...cols.map((c) => String(s.matrix[t][c] ?? 0))].map((x) => x.padEnd(10)).join(''));
  return lines.join('\n');
}
