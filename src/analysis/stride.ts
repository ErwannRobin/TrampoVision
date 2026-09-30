/** The frame rate the live view analyzes at: enough for the fastest skills (a double somersault turns about 15° between two frames), and it keeps the wait short. */
export const LIVE_ANALYSIS_FPS = 30;
/** No more than this many frames are skipped, whatever the video says. */
const MAX_STRIDE = 8;

/**
 * Every how many frames to analyze so that the analysis runs at about `target` frames per second: a phone film at 60 fps is analyzed
 * every 2nd frame, a slow-motion clip at 240 fps every 8th. The seeking that makes an analysis independent of machine speed costs the same
 * per frame, so this is what decides how long a coach waits after a set.
 */
export function analysisStride(fps: number, target = LIVE_ANALYSIS_FPS): number {
  if (!Number.isFinite(fps) || fps <= target) return 1;
  return Math.min(MAX_STRIDE, Math.max(1, Math.round(fps / target)));
}
