import { t } from '../i18n/core';
import { estimatorFactory } from '../pose/engines';
import { bodySignature, createPixelReader } from '../pose/appearance';
import { MultiAthleteTracker } from '../pose/selectAthlete';
import type { EstimatorOptions, Keypoint, PoseEstimatorFactory, WorldPoint } from '../pose/types';
import { disposeVideo, frameSeekTime, loadVideo, seekTo } from '../video/frames';
import type { PoseTrack } from './types';

/** People detected per frame, at least: the tracker needs to see the others to ignore them. */
const MIN_POSES = 4;
/** People the model looks for on top of the athletes: the ones to ignore. */
const EXTRA_POSES = 2;
/** Athletes followed when the number is left to the app (`numPoses` 0): the ones that do not jump are dropped afterwards. */
export const AUTO_ATHLETES = 3;

export interface ExtractOptions extends EstimatorOptions {
  // `numPoses` is the number of athletes to follow, each with a track of their own; 0 = up to `AUTO_ATHLETES`, to be sorted out later.
  sourceFps: number;
  /** Analyze every Nth frame (1 = every frame). */
  stride: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onBackend?: (description: string) => void;
  createEstimator?: PoseEstimatorFactory;
}

/**
 * Stage 1: walk through the video frame by frame (seek → detect) on a hidden <video> element and
 * collect the athlete's landmarks in pixel coordinates. Nothing leaves the browser.
 * Seeking (instead of real-time playback) makes the result independent of machine speed.
 */
export async function extractPoseTrack(url: string, opts: ExtractOptions): Promise<PoseTrack> {
  return (await extractPoseTracks(url, opts))[0];
}

/** Same as `extractPoseTrack`, for `opts.numPoses` athletes: one track each, in a stable order (leftmost in the first frame first). */
export async function extractPoseTracks(url: string, opts: ExtractOptions): Promise<PoseTrack[]> {
  const video = await loadVideo(url);
  try {
    return await extractFromVideo(video, opts);
  } finally {
    disposeVideo(video);
  }
}

async function extractFromVideo(video: HTMLVideoElement, opts: ExtractOptions): Promise<PoseTrack[]> {
  const { videoWidth: width, videoHeight: height, duration } = video;
  if (!width || !height || !Number.isFinite(duration)) throw new Error(t('err.dimensions'));

  const athletes = opts.numPoses > 0 ? Math.floor(opts.numPoses) : AUTO_ATHLETES;
  // Always look for more people than the athletes: with a single pose the model picks who to follow by itself and can swap
  // to somebody in the foreground. Seeing everyone lets the tracker keep the people it locked on.
  const estimator = await (opts.createEstimator ?? estimatorFactory(opts.engine))({
    ...opts,
    numPoses: Math.max(athletes + EXTRA_POSES, MIN_POSES),
  });
  const { backend } = estimator;
  opts.onBackend?.(
    `${backend.engine} · ${backend.delegate}${backend.fallbackReason ? ' (GPU failed, using CPU)' : ''}`,
  );

  try {
    const total = Math.max(1, Math.floor((duration * opts.sourceFps) / opts.stride));
    // The model is ready: the busy screen moves on from loading it to counting frames.
    opts.onProgress?.(0, total);
    const times: number[] = [];
    const frames: (Keypoint[] | null)[][] = Array.from({ length: athletes }, () => []);
    const world: (WorldPoint[] | null)[][] = Array.from({ length: athletes }, () => []);
    const tracker = new MultiAthleteTracker(athletes);
    // With several athletes the colors of their clothes help to keep them apart; one athlete needs no such help.
    const readPixels = athletes > 1 ? createPixelReader(video, width) : null;
    let lastTs = 0;

    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
      const frame = i * opts.stride;
      await seekTo(video, Math.min(frameSeekTime(frame, opts.sourceFps), duration - 1e-3));

      lastTs = Math.max(lastTs + 1, Math.round((frame / opts.sourceFps) * 1000));
      const detections = await estimator.detect(video, lastTs);
      const candidates = detections.map((d) =>
        d.landmarks.map((p) => ({ x: p.x * width, y: p.y * height, visibility: p.visibility })),
      );
      const pixels = readPixels?.() ?? null;
      const looks = candidates.map((c) => (pixels ? bodySignature(pixels, c) : null));
      const found = tracker.select(candidates, looks);
      found.forEach((athlete, a) => {
        // The 3D landmarks of the same person: the tracker returns one of the candidates, so its index is the detection's index.
        const chosen = athlete ? candidates.indexOf(athlete) : -1;
        world[a].push(chosen >= 0 ? (detections[chosen].world ?? null) : null);
        frames[a].push(athlete);
      });

      times.push(frame / opts.sourceFps);
      opts.onProgress?.(i + 1, total);
    }

    return frames.map((athleteFrames, a) => ({
      width,
      height,
      fps: opts.sourceFps / opts.stride,
      sourceFps: opts.sourceFps,
      times,
      frames: athleteFrames,
      world: world[a],
      backend: `${backend.engine} (${backend.delegate})`,
    }));
  } finally {
    estimator.dispose();
  }
}
