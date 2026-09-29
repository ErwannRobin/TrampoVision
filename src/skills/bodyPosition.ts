import type { BodyPositionThresholds } from './config';
import {
  POSITION_CODE,
  type BodyPosition,
  type KnownPosition,
  type PositionEstimate,
  type PositionScores,
} from './types';

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** 0 at `from`, 1 at `to`, linear in between (works in either direction). */
export const ramp = (x: number, from: number, to: number) => clamp01((x - from) / (to - from));

export interface ShapeMeasurement {
  /** Interior angle shoulders–hips–knees, degrees (180 = straight body). */
  hipAngle: number;
  /** Interior angle hips–knees–ankles, degrees (180 = straight legs). */
  kneeAngle: number;
  /** Distance from the knees to the trunk, in trunk lengths. NaN when unknown. */
  kneeTorso: number;
}

/**
 * Rule-based body position from joint angles and one relative distance. Each definition is a fuzzy
 * "and" of simple conditions, so a shape that sits between two definitions scores about half for both
 * and is reported as unknown instead of being forced into one.
 *
 *   straight = hips open   AND legs straight
 *   pike     = hips folded AND legs straight
 *   tuck     = hips folded AND knees bent  (knees drawn toward the torso add up to 30%)
 *
 * The reported score is the winner's score minus half the runner-up's, so a near tie is weak.
 */
export function classifyPosition(m: ShapeMeasurement, t: BodyPositionThresholds): PositionEstimate {
  const scores: PositionScores = { straight: 0, tuck: 0, pike: 0 };
  if (!Number.isFinite(m.hipAngle) || !Number.isFinite(m.kneeAngle)) return { label: 'unknown', scores, ruleScore: 0 };

  const folded = ramp(m.hipAngle, t.hipOpenMinDeg, t.hipFoldedMaxDeg); // 1 at or below hipFoldedMax
  const legsStraight = ramp(m.kneeAngle, t.kneeBentMaxDeg, t.kneeStraightMinDeg); // 1 at or above kneeStraightMin
  const kneesNear = Number.isFinite(m.kneeTorso) ? ramp(m.kneeTorso, t.kneeTorsoFar, t.kneeTorsoNear) : 0.5;

  scores.straight = (1 - folded) * legsStraight;
  scores.pike = folded * legsStraight;
  scores.tuck = folded * (1 - legsStraight) * (0.7 + 0.3 * kneesNear);

  const ranked = (Object.keys(scores) as KnownPosition[]).sort((a, b) => scores[b] - scores[a]);
  const ruleScore = Math.max(0, scores[ranked[0]] - 0.5 * scores[ranked[1]]);
  const label: BodyPosition = ruleScore >= t.minScore ? ranked[0] : 'unknown';
  return { label, scores, ruleScore: label === 'unknown' ? 0 : ruleScore };
}

/** Numeric code per position, for per-sample arrays. */
export const positionCode = (p: BodyPosition) => POSITION_CODE[p];
