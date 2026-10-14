import { LM } from '../pose/landmarks';
import { verticalTravel } from '../motion/jumperSelect';
import type { PoseTrack } from './types';

/** A track needs a pose in this share of the frames to be an athlete and not somebody who walked through. */
const MIN_FOUND = 0.2;
/** How far back the travel of the hips is measured, seconds: one to two jumps. */
const WINDOW_S = 3;
/** A landmark with less visibility than this says nothing about where the hips are. */
const SEEN = 0.3;
/** Below this much travel of the best track, picture heights, travel says nothing: a camera that follows the athlete keeps their hips still in the picture. */
const MIN_TRAVEL = 0.08;
/** A track that travels less than this share of the best one is not an athlete: a spotter whose arm raises counted as jumps travels a few percent of a jumper. */
const TRAVEL_SHARE = 0.25;

/**
 * How far the hips of a track go up and down, as a share of the picture's height: the median, over the clip, of the travel inside a
 * window of a jump or two. A jumper measures most of the jump height; a spotter who stands under them and raises their arms at every
 * landing, or a judge, measures a few percent. 0 when the track has no hips to read.
 */
export function trackTravel(track: PoseTrack): number {
  const samples: { t: number; y: number }[] = [];
  track.frames.forEach((frame, i) => {
    const t = track.times[i];
    if (!frame || t === undefined) return;
    const hips = [frame[LM.L_HIP], frame[LM.R_HIP]].filter((p) => p && p.visibility >= SEEN);
    if (!hips.length) return;
    samples.push({ t, y: hips.reduce((a, p) => a + p.y, 0) / hips.length / track.height });
  });
  if (!samples.length) return 0;
  const travels: number[] = [];
  const last = samples[samples.length - 1].t;
  for (let start = samples[0].t; start <= last; start += WINDOW_S / 2) {
    const window = samples.filter((s) => s.t >= start && s.t < start + WINDOW_S);
    travels.push(verticalTravel(window, WINDOW_S));
  }
  travels.sort((a, b) => a - b);
  return travels[Math.floor(travels.length / 2)] ?? 0;
}

/**
 * Keeps the tracks of the people who jump: when the number of athletes was left to the app it follows the biggest few
 * people, and those who only stand or walk (a coach, a judge) are not athletes. Among the ones who jump, the travel of the
 * hips (`trackTravel`) names the athlete: the jumper's hips go through the jump height, a spotter under their path — bigger
 * in the picture, and counting as a jumper when their arm raises register as jumps — barely moves. The track that travels
 * most comes first, and one that travels a small share of it is dropped; when nobody travels (a camera that follows the
 * athlete keeps their hips still in the picture) the given order is kept. Never empty: when nobody jumps, the track with
 * the most poses stays, so a clip always has an athlete to show.
 */
export function keepAthletes(tracks: PoseTrack[], jumpCount: (track: PoseTrack) => number): PoseTrack[] {
  const found = (t: PoseTrack) => t.frames.filter(Boolean).length;
  const travel = new Map(tracks.map((t) => [t, trackTravel(t)]));
  // A track that travels like a jumper is an athlete however sparse it is, and whether or not its jumps could be counted:
  // on a hard clip the pose model sees the jumper in a tenth of the frames, scattered, and the person it sees all the time
  // is the spotter.
  const kept = tracks.filter(
    (t) => (found(t) >= MIN_FOUND * t.frames.length && jumpCount(t) > 0) || travel.get(t)! >= MIN_TRAVEL,
  );
  if (kept.length) {
    const best = Math.max(...kept.map((t) => travel.get(t)!));
    if (best < MIN_TRAVEL) return kept;
    return kept.filter((t) => travel.get(t)! >= TRAVEL_SHARE * best).sort((a, b) => travel.get(b)! - travel.get(a)!);
  }
  // Nobody jumps by the count: the track that travels most (a sparse jumper's jumps may not be countable), else the one
  // with the most poses, so a clip always has an athlete to show.
  const traveling = tracks.filter((t) => travel.get(t)! >= MIN_TRAVEL);
  if (traveling.length) return [traveling.reduce((a, b) => (travel.get(b)! > travel.get(a)! ? b : a))];
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
