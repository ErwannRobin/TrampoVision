import type { JumpCycle } from '../../analysis/jumpCycles';
import type { Metrics } from '../../dataset/metrics';
import type { JumpRecord } from '../../dataset/types';
import { t, tp } from '../../i18n/core';

/**
 * Where "Next unlabeled" goes: the first jump after `from` without a label, wrapping around the clip. It is `from`
 * itself when that is the only one left, and null when every jump has a label.
 */
export function nextUnlabeled(labeled: readonly boolean[], from: number): number | null {
  const n = labeled.length;
  for (let step = 1; step <= n; step++) {
    const j = (from + step) % n;
    if (!labeled[j]) return j;
  }
  return null;
}

/** What "Play jump" plays: a moment before takeoff to a moment after landing (the apex stands in for a cut-off edge). */
export function jumpPlayRange(
  cycle: Pick<JumpCycle, 'takeoffTimeS' | 'apexTimeS' | 'landingTimeS'>,
): [from: number, to: number] {
  return [Math.max(0, (cycle.takeoffTimeS ?? cycle.apexTimeS) - 0.4), (cycle.landingTimeS ?? cycle.apexTimeS) + 0.3];
}

/** The line under the label buttons: why they cannot be used yet, what to do, or that the label is stored. */
export function labelStatus(state: { ready: boolean; labeled: boolean; saved: boolean }): string {
  if (!state.ready) return t('review.status.reading');
  if (state.labeled) return state.saved ? t('review.status.saved') : '';
  return t('review.status.choose');
}

/** Tint of a confusion matrix cell (share of full color). Capped so the count stays readable on it in both themes. */
export const HEAT_MIN = 0.14;
export const HEAT_MAX = 0.56;

/** Faint for one jump, strongest for the most common cell of the matrix; nothing for an empty cell. */
export function heatStrength(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return HEAT_MIN + (HEAT_MAX - HEAT_MIN) * Math.min(1, count / max);
}

export interface SparkLayout {
  /** SVG path data. A missing sample lifts the pen, so a gap in the data stays a gap. */
  path: string;
  /** Vertical position of each guide that falls inside the drawn range. */
  guides: number[];
  /** Range of the values that exist. */
  min: number;
  max: number;
}

const PAD_X = 2;
const PAD_Y = 3;

/** Turns one normalized curve into a path in a `width` x `height` box; null when it has no value at all. */
export function sparkLayout(
  values: readonly (number | null)[],
  size: { width: number; height: number },
  options: { domain?: [number, number]; guides?: number[] } = {},
): SparkLayout | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!finite.length) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const lo = options.domain ? options.domain[0] : Math.min(min, 0);
  const hi = options.domain ? options.domain[1] : Math.max(max, lo + 0.5);
  const x = (i: number) => PAD_X + (values.length > 1 ? i / (values.length - 1) : 0.5) * (size.width - 2 * PAD_X);
  const y = (v: number) => size.height - PAD_Y - ((v - lo) / (hi - lo || 1)) * (size.height - 2 * PAD_Y);
  let path = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const guides = (options.guides ?? []).filter((g) => g >= lo && g <= hi).map(y);
  return { path, guides, min, max };
}

export interface DatasetSummary {
  jumps: number;
  videos: number;
  labeled: number;
}

export function summarizeDataset(records: readonly Pick<JumpRecord, 'videoId' | 'truth'>[]): DatasetSummary {
  return {
    jumps: records.length,
    videos: new Set(records.map((r) => r.videoId)).size,
    labeled: records.filter((r) => r.truth).length,
  };
}

/** The counts shown next to the closed "Dataset on this computer" row. */
export function datasetMeta({ jumps, labeled }: Pick<DatasetSummary, 'jumps' | 'labeled'>): string {
  return jumps === 0 ? t('dataset.none') : t('dataset.meta', { jumps: tp('count.jumps', jumps), labeled });
}

/** What is in the scope of the report: the saved jumps, and how many carry which kind of label. */
export function describeCounts(c: Metrics['counts']): string {
  return t('report.counts', {
    saved: tp('report.savedJumps', c.records),
    labeled: c.labeled,
    known: c.known,
    unknown: c.unknown,
    unlabeled: c.unlabeled,
  });
}

/** Why the numbers of the report should not be over-read. */
export function reportCaveats(evaluated: number, noExample: readonly string[], configs: number): string[] {
  const out: string[] = [];
  if (evaluated < 30) out.push(tp('report.caveat.few', evaluated));
  if (noExample.length > 0) out.push(t('report.caveat.noExample', { classes: noExample.join(t('list.separator')) }));
  if (configs > 1) out.push(t('report.caveat.configs', { n: configs }));
  out.push(t('report.caveat.notClassified'));
  return out;
}

/** "3 checks differ", "1 check differs". */
export function checkCount(differing: number): string {
  return tp('fail.checkCount', differing);
}
