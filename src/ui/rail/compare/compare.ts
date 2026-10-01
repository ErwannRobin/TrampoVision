import type { AnalysisResult } from '../../../analysis/types';
import { t } from '../../../i18n/core';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { confidenceTier, skillName, type ConfidenceTier } from '../../insights';

/** One athlete of the clip: what the pipeline made of their track. */
export interface AthleteView {
  result: AnalysisResult;
  skills: SkillAnalysis;
}

/** The colors that tell the athletes apart: chart series (css variables) and the skeleton on the video (fixed values). */
export const ATHLETE_SERIES = ['--series-1', '--series-2', '--series-3'] as const;
export const ATHLETE_TINTS = ['#5da9ff', '#ff9350', '#19d3c5'] as const;

export interface CompareStat {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  /** One value per athlete; NaN when unknown. */
  values: number[];
  /** Index of the athlete with the highest value, or -1 when there is no winner to point at (a tie, or no data). */
  best: number;
}

/** The index of the single highest finite value, or -1 when it is a tie or nothing is known. */
export function bestIndex(values: number[]): number {
  let best = -1;
  let top = -Infinity;
  let tied = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    if (v > top) {
      top = v;
      best = i;
      tied = false;
    } else if (v === top) tied = true;
  });
  return tied ? -1 : best;
}

/** The summary figures of every athlete in one table. */
export function compareStats(views: AthleteView[]): CompareStat[] {
  const row = (
    key: string,
    label: string,
    unit: string,
    decimals: number,
    pick: (r: AnalysisResult) => number,
    withBest = true,
  ): CompareStat => {
    const values = views.map((v) => pick(v.result));
    return { key, label, unit, decimals, values, best: withBest ? bestIndex(values) : -1 };
  };
  return [
    row('jumps', t('compare.jumps'), '', 0, (r) => r.summary.jumpCount, false),
    row('height', t('compare.maxHeight'), 'm', 2, (r) => r.summary.maxHeightM),
    row('peakUp', t('compare.peakUp'), 'm/s', 1, (r) => r.summary.peakUpVelocity),
    row('rotations', t('compare.rotations'), '', 0, (r) => r.summary.completedRotations),
  ];
}

export interface CompareJumpCell {
  label: string;
  tier: ConfidenceTier;
  heightM: number;
}

export interface CompareJumpRow {
  /** 1-based jump number: the n-th jump of each athlete, side by side. */
  number: number;
  /** One cell per athlete; null where the athlete has fewer jumps. */
  cells: (CompareJumpCell | null)[];
}

/** The n-th jump of every athlete on one row: the skill each was given and how high it went. */
export function compareJumpRows(views: AthleteView[]): CompareJumpRow[] {
  const rows = Math.max(0, ...views.map((v) => v.skills.jumps.length));
  return Array.from({ length: rows }, (_, i) => ({
    number: i + 1,
    cells: views.map((v) => {
      const j = v.skills.jumps[i];
      if (!j) return null;
      return {
        label: skillName(j.prediction),
        tier: confidenceTier(j.prediction, v.skills.config.minConfidence),
        heightM: j.features.trajectory.maxHeightM,
      };
    }),
  }));
}
