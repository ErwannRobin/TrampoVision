import { createMediaPipeEstimator } from '../pose/MediaPipePoseEstimator';
import { selectAthlete } from '../pose/selectAthlete';
import type { EstimatorOptions, Keypoint, PoseEstimatorFactory } from '../pose/types';
import { frameSeekTime, loadVideo, seekTo } from '../video/frames';
import type { PoseTrack } from './types';

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
  const { videoWidth: width, videoHeight: height, duration } = video;
  if (!width || !height || !Number.isFinite(duration)) throw new Error('Could not read the video dimensions/duration.');

  const estimator = await (opts.createEstimator ?? createMediaPipeEstimator)(opts);
  const { backend } = estimator;
  opts.onBackend?.(
    `${backend.engine} · ${backend.delegate}${backend.fallbackReason ? ' (GPU failed, using CPU)' : ''}`,
  );

  try {
    const total = Math.max(1, Math.floor((duration * opts.sourceFps) / opts.stride));
    const times: number[] = [];
    const frames: (Keypoint[] | null)[] = [];
    let previous: Keypoint[] | null = null;
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
      const athlete = selectAthlete(candidates, previous);
      if (athlete) previous = athlete;

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
      backend: `${backend.engine} (${backend.delegate})`,
    };
  } finally {
    estimator.dispose();
    video.removeAttribute('src');
    video.load();
  }
}
