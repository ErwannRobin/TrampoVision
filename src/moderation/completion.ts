import { computeAnalysis } from '../analysis/computeAnalysis';
import { parsePoseSeries } from '../analysis/timeSeries';
import type { AnalysisResult } from '../analysis/types';

/**
 * How much of a shared clip the app read well, for the moderation page: the share of the clip where the athlete is found inside a
 * run of bounces, each with its take-off and its landing (the up-and-down curve of the height). A clip read end to end while the
 * athlete bounces is near 100%; the time spent climbing on the bed or walking off, frames where the athlete is lost and stretches
 * that do not look like bounces all lower it.
 */
export interface Completion {
  /** 0..1. */
  score: number;
  /** Share of the frames where the athlete is found at all, 0..1. */
  found: number;
  /** Jumps with both their take-off and their landing. */
  jumps: number;
}

/** Longest stay on the bed between two jumps of one run. A contact lasts 0.2 to 0.5 s; a longer stop starts a new run. */
export const MAX_CONTACT_S = 1.5;
/** A single jump alone is as likely a misreading as a bounce: a run has at least this many. */
export const MIN_RUN = 2;

export function completion(result: AnalysisResult): Completion {
  const n = result.time.length;
  const complete = result.jumps.cycles.filter((c) => c.takeoff !== null && c.landing !== null);
  const inRun = new Uint8Array(n);
  let run: { start: number; end: number; jumps: number } | null = null;
  const close = () => {
    if (run && run.jumps >= MIN_RUN) inRun.fill(1, run.start, run.end + 1);
  };
  for (const c of complete) {
    const takeoff = c.takeoff!;
    const landing = c.landing!;
    if (run && result.time[takeoff] - result.time[run.end] <= MAX_CONTACT_S) {
      run.end = landing;
      run.jumps++;
    } else {
      close();
      run = { start: takeoff, end: landing, jumps: 1 };
    }
  }
  close();

  let found = 0;
  let read = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(result.comY[i])) continue;
    found++;
    if (inRun[i]) read++;
  }
  return { score: n ? read / n : 0, found: n ? found / n : 0, jumps: complete.length };
}

/** The completion of a saved analysis (the text a shared clip carries), run as the app opens it. Throws a readable Error. */
export function seriesCompletion(text: string): Completion {
  const parsed = parsePoseSeries(text);
  return completion(
    computeAnalysis(parsed.track, {
      athleteHeightM: parsed.settings.athleteHeightM,
      scaleSource: parsed.settings.scaleSource,
      calibration: parsed.calibration,
    }),
  );
}

/** A score as the page shows it, with its tone: 80% and above reads well, under 50% is mostly lost. */
export function completionBadge(score: number): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  const text = `Analyzed ${Math.round(score * 100)}%`;
  return { text, tone: score >= 0.8 ? 'ok' : score >= 0.5 ? 'warn' : 'danger' };
}
