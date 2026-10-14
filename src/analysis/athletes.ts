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

/** How sure the model is of a pose: the mean visibility of its points. */
const poseScore = (pose: { visibility?: number }[]) =>
  pose.reduce((s, p) => s + (p.visibility ?? 0), 0) / Math.max(1, pose.length);

/**
 * One athlete out of several tracks that were the same person (found twice, or lost and found again as somebody else).
 * Frame by frame it keeps the pose that was found; when more than one track has a pose, the one the model is surest of.
 * The tracks come from the same clip, so they share their frames and times; the first one gives the rest.
 */
export function mergeTracks(tracks: PoseTrack[]): PoseTrack {
  const [first] = tracks;
  if (tracks.length < 2) return first;
  const pick = first.frames.map((_, i) => {
    let best = -1;
    let score = -Infinity;
    tracks.forEach((tr, a) => {
      const pose = tr.frames[i];
      if (!pose) return;
      const s = poseScore(pose);
      if (s > score) [best, score] = [a, s];
    });
    return best;
  });
  const hasWorld = tracks.some((tr) => tr.world);
  return {
    ...first,
    frames: pick.map((a, i) => (a >= 0 ? tracks[a].frames[i] : null)),
    ...(hasWorld ? { world: pick.map((a, i) => (a >= 0 ? (tracks[a].world?.[i] ?? null) : null)) } : null),
  };
}
