import { computeAnalysis } from '../analysis/computeAnalysis';
import { buildPoseSeries, parsePoseSeries, toSeriesJson, type ParsedSeries } from '../analysis/timeSeries';
import type { AnalysisResult, PoseTrack } from '../analysis/types';
import { completion, runMask, type Completion } from '../moderation/completion';
import { CORE_LANDMARKS } from '../pose/landmarks';

/**
 * Keeping the best analysis of each video of the library. Several people analyze the same clip, each with their own settings (pose
 * model, second look, motion detector, calibration), and each reading is good where the others lose the athlete. `pickBest` keeps
 * the one that read the most of the clip (`completion`), and when two readings of the same frames cover different stretches well,
 * it stitches them into a third and keeps that one if it reads more than both. It never keeps a reading that is worse than what
 * is stored, so uploading can only improve a clip.
 *
 * Pure code, shared by the review Worker (which runs it on every upload, so the score cannot be claimed) and the tests.
 */

/** A saved analysis, read back: the raw track, the analysis it gives, and how much of the clip it read well. */
export interface Reading {
  parsed: ParsedSeries;
  result: AnalysisResult;
  completion: Completion;
  /** Frames inside a run of bounces. */
  inRun: Uint8Array;
}

/** What a merged reading must beat the better of its two sources by: a tie is not worth a new version. */
export const MIN_GAIN = 0.005;
/** The cost, in frame-quality points, of changing source: a stretch has to be clearly better to be taken over. */
export const SWITCH_COST = 6;
/** Two sources read the same body in a frame when their core joints are this close (in body lengths, on average). */
export const SAME_BODY = 0.15;

/** Reads a saved analysis (the pose-series JSON). Throws a readable Error when it is not one. */
export function readSeries(text: string): Reading {
  const parsed = parsePoseSeries(text);
  return readingOf(parsed, computeOf(parsed.track, parsed));
}

function computeOf(track: PoseTrack, parsed: Pick<ParsedSeries, 'settings' | 'calibration'>): AnalysisResult {
  return computeAnalysis(track, {
    athleteHeightM: parsed.settings.athleteHeightM,
    scaleSource: parsed.settings.scaleSource,
    calibration: parsed.calibration,
    minVisibility: parsed.settings.minVisibility,
  });
}

function readingOf(parsed: ParsedSeries, result: AnalysisResult): Reading {
  return { parsed, result, completion: completion(result), inRun: runMask(result) };
}

/** Whether the two tracks hold the same frames of the same video, so that frame i of one is frame i of the other. */
export function sameFrames(a: PoseTrack, b: PoseTrack): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.sourceFps === b.sourceFps &&
    a.fps === b.fps &&
    a.times.length === b.times.length &&
    a.times.every((t, i) => Math.abs(t - b.times[i]) < 1e-3)
  );
}

/** Mean distance between the core joints of two readings of a frame, in pixels; Infinity when either has none. */
function jointGap(a: PoseTrack['frames'][number], b: PoseTrack['frames'][number]): number {
  if (!a || !b) return Infinity;
  let sum = 0;
  for (const k of CORE_LANDMARKS) sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  return sum / CORE_LANDMARKS.length;
}

/** How well a reading serves the frame: inside a run of bounces counts most, then having found the athlete, then how sure. */
const quality = (r: Reading, i: number) =>
  (r.inRun[i] ? 2 : 0) + (r.parsed.track.frames[i] ? 1 : 0) + (r.result.confidence[i] || 0);

/** Frames where both readings found somebody, and the share of those where they found the same body. */
export const MIN_OVERLAP = 10;
export const MIN_AGREEMENT = 0.7;

/** Per frame: 1 when both readings show the same body, 0 when both show somebody and it is not the same, 2 when one of them shows nobody. */
function agreement(a: Reading, b: Reading): Uint8Array {
  const n = a.parsed.track.frames.length;
  const body = Number.isFinite(a.result.meta.bodyLengthPx) ? a.result.meta.bodyLengthPx : a.parsed.track.height * 0.3;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const fa = a.parsed.track.frames[i];
    const fb = b.parsed.track.frames[i];
    out[i] = !fa || !fb ? 2 : jointGap(fa, fb) <= SAME_BODY * body ? 1 : 0;
  }
  return out;
}

/**
 * Whether the two readings follow the same athlete: they have a stretch where both found somebody, and there it is the same body
 * (another person, a spotter or a judge, reads as a different body). Readings that never overlap cannot be told apart, so they are
 * not stitched.
 */
export function sameAthlete(a: Reading, b: Reading): boolean {
  let both = 0;
  let same = 0;
  for (const v of agreement(a, b)) {
    if (v !== 2) both++;
    if (v === 1) same++;
  }
  return both >= MIN_OVERLAP && same >= MIN_AGREEMENT * both;
}

/**
 * For each frame, which of the two readings to take: 0 for `a`, 1 for `b`. The total quality is maximized, and every change of source
 * costs SWITCH_COST and never happens at a frame where the two readings disagree about where the athlete is.
 */
export function chooseSources(a: Reading, b: Reading): Uint8Array {
  const n = a.parsed.track.frames.length;
  const agree = agreement(a, b);
  // Viterbi over two states; `from[s][i]` is the state taken at frame i - 1 to be in state s at frame i.
  const from = [new Uint8Array(n), new Uint8Array(n)];
  let score = [quality(a, 0), quality(b, 0)];
  for (let i = 1; i < n; i++) {
    const next = [0, 0];
    for (const s of [0, 1]) {
      const stay = score[s];
      const move = agree[i] !== 0 ? score[1 - s] - SWITCH_COST : -Infinity;
      from[s][i] = move > stay ? 1 - s : s;
      next[s] = Math.max(stay, move) + quality(s === 0 ? a : b, i);
    }
    score = next;
  }
  const pick = new Uint8Array(n);
  let s = score[1] > score[0] ? 1 : 0;
  for (let i = n - 1; i >= 0; i--) {
    pick[i] = s;
    if (i > 0) s = from[s][i];
  }
  return pick;
}

/**
 * The two readings stitched into one, or null when that is not possible: not the same frames, several athletes (each would need its own
 * stitching), or the readings never take turns. The other fields come from the better reading, whose calibration and scale go with it.
 */
export function mergeReadings(a: Reading, b: Reading): Reading | null {
  if (a.parsed.tracks.length !== 1 || b.parsed.tracks.length !== 1) return null;
  if (!sameFrames(a.parsed.track, b.parsed.track) || !sameAthlete(a, b)) return null;
  const pick = chooseSources(a, b);
  const used = pick.reduce((sum, v) => sum + v, 0);
  if (used === 0 || used === pick.length) return null;

  const better = a.completion.score >= b.completion.score ? a : b;
  const ta = a.parsed.track;
  const tb = b.parsed.track;
  const world = ta.world && tb.world ? ta.world.map((w, i) => (pick[i] ? tb.world![i] : w)) : undefined;
  const track: PoseTrack = {
    ...ta,
    frames: ta.frames.map((f, i) => (pick[i] ? tb.frames[i] : f)),
    ...(world ? { world } : {}),
    backend: ta.backend === tb.backend ? ta.backend : `${ta.backend} + ${tb.backend}`,
  };
  if (!world) delete track.world;
  const parsed: ParsedSeries = { ...better.parsed, track, tracks: [track] };
  return readingOf(parsed, computeOf(track, parsed));
}

/** A reading as the series JSON that stores it. */
export function writeSeries(reading: Reading): string {
  const { parsed, result } = reading;
  const [track] = parsed.tracks;
  return toSeriesJson(
    buildPoseSeries(result, track, {
      fileName: parsed.source.fileName,
      videoId: parsed.source.videoId,
      stride: Math.max(1, Math.round(parsed.source.sourceFps / parsed.source.fps)),
      minVisibility: parsed.settings.minVisibility,
      calibration: parsed.calibration,
    }),
  );
}

export type Choice = 'stored' | 'incoming' | 'merged';

export interface Picked {
  choice: Choice;
  /** What to keep. */
  best: Reading;
}

/** Whether `a` reads more of the clip than `b`: the score first, then the share where the athlete is found. */
const reads = (a: Completion, b: Completion, gain = 0) =>
  a.score > b.score + gain || (gain === 0 && a.score === b.score && a.found > b.found);

/** The best of what is stored and what came in, or of a stitching of the two. `stored` null: a first analysis, kept. */
export function pickBest(stored: Reading | null, incoming: Reading): Picked {
  if (!stored) return { choice: 'incoming', best: incoming };
  const [leader, other] = reads(incoming.completion, stored.completion)
    ? ([incoming, stored] as const)
    : ([stored, incoming] as const);
  const merged = mergeReadings(leader, other);
  if (merged && reads(merged.completion, leader.completion, MIN_GAIN)) return { choice: 'merged', best: merged };
  return leader === incoming ? { choice: 'incoming', best: incoming } : { choice: 'stored', best: stored };
}
