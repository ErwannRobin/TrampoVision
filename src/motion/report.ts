import type { CameraType } from './config';
import type { Box } from './types';

/**
 * What a run of the detector over a clip said about one frame, and what is reported of a whole run: the part of the real-footage check
 * (`scripts/motion-eval.ts`) that has no video in it, so that it can be tested.
 */
export interface FrameRow {
  /** Seconds into the clip. */
  t: number;
  found: boolean;
  /** The box of the first athlete, picture pixels, or null when none was found. */
  box: Box | null;
  type: CameraType;
  /** The share of the picture the mask keeps (1: nothing hidden). */
  coverage: number;
  periodS: number | null;
}

export interface MotionSummary {
  frames: number;
  /** Frames in which an athlete was found. */
  found: number;
  /** The width of the athlete's box over the frames where one was found, picture pixels: a box that swallows the bed is a wide one. */
  width: { median: number; p90: number; max: number };
  /** The mean share of the picture kept over those frames; 1 when there were none. */
  coverage: number;
}

/** The value `share` of the way up the sorted values; 0 when there are none. */
function quantile(values: number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

export function summarize(rows: FrameRow[]): MotionSummary {
  const withAthlete = rows.filter((r) => r.found && r.box);
  const widths = withAthlete.map((r) => r.box!.x1 - r.box!.x0 + 1);
  const coverage = withAthlete.length ? withAthlete.reduce((sum, r) => sum + r.coverage, 0) / withAthlete.length : 1;
  return {
    frames: rows.length,
    found: withAthlete.length,
    width: { median: quantile(widths, 0.5), p90: quantile(widths, 0.9), max: quantile(widths, 1) },
    coverage,
  };
}

export function formatSummary(s: MotionSummary): string {
  const share = s.frames ? Math.round((100 * s.found) / s.frames) : 0;
  return (
    `${s.frames} frames, an athlete in ${s.found} (${share}%); box width median ${s.width.median}, ` +
    `90th percentile ${s.width.p90}, widest ${s.width.max} picture pixels; ${Math.round(100 * s.coverage)}% of the picture kept`
  );
}

const boxText = (b: Box | null): string => (b ? `[${b.x0},${b.y0}-${b.x1},${b.y1}]` : '-');

/** One line for every whole second of the clip, from the frame at that second: what the detector believed then. */
export function formatSeconds(rows: FrameRow[]): string[] {
  if (!rows.length) return [];
  const lines: string[] = [];
  const last = rows[rows.length - 1].t;
  let k = 0;
  for (let second = 0; second <= last; second++) {
    while (k + 1 < rows.length && rows[k + 1].t <= second) k++;
    const r = rows[k];
    lines.push(
      `${second.toFixed(1).padStart(5)} s  ${(r.found ? 'found' : '-').padEnd(5)}  ${boxText(r.box).padEnd(18)} ${r.type.padEnd(8)} ` +
        `T=${r.periodS === null ? '-' : `${r.periodS.toFixed(2)} s`}  kept ${Math.round(100 * r.coverage)}%`,
    );
  }
  return lines;
}
