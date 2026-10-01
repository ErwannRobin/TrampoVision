import type { PoseTrack } from './types';

/** A track needs a pose in this share of the frames to be an athlete and not somebody who walked through. */
const MIN_FOUND = 0.2;

/**
 * Keeps the tracks of the people who jump: when the number of athletes was left to the app it follows the biggest few
 * people, and those who only stand or walk (a coach, a judge) are not athletes. Order is kept. Never empty: when nobody
 * jumps, the track with the most poses stays, so a clip always has an athlete to show.
 */
export function keepAthletes(tracks: PoseTrack[], jumpCount: (track: PoseTrack) => number): PoseTrack[] {
  const found = (t: PoseTrack) => t.frames.filter(Boolean).length;
  const kept = tracks.filter((t) => found(t) >= MIN_FOUND * t.frames.length && jumpCount(t) > 0);
  if (kept.length) return kept;
  const best = tracks.reduce((a, b) => (found(b) > found(a) ? b : a), tracks[0]);
  return best ? [best] : [];
}
