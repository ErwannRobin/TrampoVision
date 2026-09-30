import { t } from '../../i18n/core';

/** How far along the analysis must be, and for how long it must have run, before a time estimate means something. */
// The first frames are slow (the model warms up), so an earlier guess would be far too pessimistic.
const MIN_PROGRESS = 0.08;
const MIN_ELAPSED_S = 4;
const STEP_S = 5;

/** Seconds left, rounded to 5 s, from how long the work has taken so far; null while it is too early to guess. */
export function estimateRemaining(elapsedS: number, progress: number): number | null {
  if (!(progress >= MIN_PROGRESS) || !(elapsedS >= MIN_ELAPSED_S)) return null;
  const left = (elapsedS * (1 - Math.min(progress, 1))) / progress;
  return Math.round(left / STEP_S) * STEP_S;
}

/** "About 40 s left", "About 1 min 35 s left". */
export function formatRemaining(seconds: number): string {
  if (seconds < STEP_S) return t('eta.almost');
  if (seconds < 60) return t('eta.seconds', { s: seconds });
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? t('eta.minutesSeconds', { m: minutes, s: rest }) : t('eta.minutes', { m: minutes });
}
