import { t } from '../i18n/core';
import { createMediaPipeEstimator } from '../pose/MediaPipePoseEstimator';
import { AthleteTracker } from '../pose/selectAthlete';
import type { EstimatorOptions, Keypoint, PoseEstimatorFactory, WorldPoint } from '../pose/types';
import { disposeVideo, frameSeekTime, loadVideo, seekTo } from '../video/frames';
import type { PoseTrack } from './types';

/** People detected per frame, whatever the setting: the tracker needs to see the others to ignore them. */
const MIN_POSES = 4;

export interface ExtractOptions extends EstimatorOptions {
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
  const video = await loadVideo(url);
  try {
    return await extractFromVideo(video, opts);
  } finally {
    disposeVideo(video);
  }
}

async function extractFromVideo(video: HTMLVideoElement, opts: ExtractOptions): Promise<PoseTrack> {
  const { videoWidth: width, videoHeight: height, duration } = video;
  if (!width || !height || !Number.isFinite(duration)) throw new Error(t('err.dimensions'));

  // Always look for several people: with a single pose the model picks who to follow by itself and can swap to somebody
  // in the foreground. Seeing everyone lets the tracker keep the person it locked on.
  const estimator = await (opts.createEstimator ?? createMediaPipeEstimator)({
    ...opts,
    numPoses: Math.max(opts.numPoses, MIN_POSES),
  });
  const { backend } = estimator;
  opts.onBackend?.(
    `${backend.engine} · ${backend.delegate}${backend.fallbackReason ? ' (GPU failed, using CPU)' : ''}`,
  );

  try {
    const total = Math.max(1, Math.floor((duration * opts.sourceFps) / opts.stride));
    const times: number[] = [];
    const frames: (Keypoint[] | null)[] = [];
    const world: (WorldPoint[] | null)[] = [];
    const tracker = new AthleteTracker();
    let lastTs = 0;

    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
      const frame = i * opts.stride;
      await seekTo(video, Math.min(frameSeekTime(frame, opts.sourceFps), duration - 1e-3));

      lastTs = Math.max(lastTs + 1, Math.round((frame / opts.sourceFps) * 1000));
      const detections = estimator.detect(video, lastTs);
      const candidates = detections.map((d) =>
        d.landmarks.map((p) => ({ x: p.x * width, y: p.y * height, visibility: p.visibility })),
      );
      const athlete = tracker.select(candidates);
      // The 3D landmarks of the same person: `selectAthlete` returns one of the candidates, so its index is the detection's index.
      const chosen = athlete ? candidates.indexOf(athlete) : -1;
      world.push(chosen >= 0 ? (detections[chosen].world ?? null) : null);

      times.push(frame / opts.sourceFps);
      frames.push(athlete);
      opts.onProgress?.(i + 1, total);
    }

    return {
      width,
      height,
      fps: opts.sourceFps / opts.stride,
      sourceFps: opts.sourceFps,
      times,
      frames,
      world,
      backend: `${backend.engine} (${backend.delegate})`,
    };
  } finally {
    estimator.dispose();
  }
}
