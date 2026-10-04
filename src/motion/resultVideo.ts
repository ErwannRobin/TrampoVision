import { disposeVideo, frameSeekTime, loadVideo, seekTo } from '../video/frames';
import { encodeMp4, exportSize } from '../video/exportVideo';
import type { MotionConfig } from './config';
import { CanvasMaskLayer } from './layer';
import { hidesSomething } from './maskedEstimator';
import { AthleteScout, SCOUT_MAX_S } from './scout';
import type { Box } from './types';

/**
 * The result of the motion detector as a video: the clip, run through the detector from its first frame, with every frame painted the way
 * the pose model is given it (the background hidden once the detector is sure where the athlete is). It is a video like any other, so the
 * app opens it with no change to its analysis: that is how the result goes to the app (see `handoff.ts`).
 */

/** Which frames of the clip the result is made of, and the rate they play at. */
export interface ResultPlan {
  frames: number;
  /** The frame rate of the result: that of the clip over `stride`. */
  fps: number;
}

/**
 * Every `stride`-th frame of the clip, the ones the analysis looks at (about 30 a second, see `analysisStride`). Frame `k` of the result is
 * at `k / fps`, which is the time of the frame it was made from, so the app measures the same timeline in the result as in the clip.
 */
export function resultPlan(durationS: number, sourceFps: number, stride: number): ResultPlan {
  return { frames: Math.max(1, Math.floor((durationS * sourceFps) / stride)), fps: sourceFps / stride };
}

/** The name of the result: that of the clip, with "-masked" and the MP4 extension. */
export function maskedName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  return `${base || 'video'}-masked.mp4`;
}

export interface RenderOptions {
  /** The clip. */
  url: string;
  /** Its frame rate, and every how many frames of it are analyzed. */
  sourceFps: number;
  stride: number;
  /** The detector's thresholds and what is painted over the background, as the page has them set. */
  config?: Partial<MotionConfig>;
  fill?: string;
  signal?: AbortSignal;
  /** After every frame: how many are done, how many there are, and in how many of them the background was hidden. */
  onProgress?: (done: number, total: number, hidden: number) => void;
  /** While the start of the clip is looked at to find where the athlete is (before the clip is made): how many frames are done, and the most there can be. */
  onScout?: (done: number, total: number) => void;
}

export interface RenderedVideo {
  /** An MP4: H.264, or VP9 where the browser cannot encode H.264 (it then decodes what it encoded). */
  blob: Blob;
  frames: number;
  /** Frames in which the detector hid something. None means the athlete was never found and the result is the clip as it was. */
  hidden: number;
}

/**
 * Looks at the start of the clip with a detector of its own, until the athlete is found and a jump more has been seen, and says where they
 * jump. The detector of the clip itself needs two and a half jumps to be sure, and the frames before that would be given to the pose model
 * with the people who stand around the bed; this run is what lets them be masked too. Null when the athlete is not found.
 */
async function scoutAthlete(video: HTMLVideoElement, options: RenderOptions, plan: ResultPlan): Promise<Box | null> {
  const { sourceFps, stride, signal } = options;
  const layer = new CanvasMaskLayer(options.config, options.fill);
  const scout = new AthleteScout();
  const total = Math.min(plan.frames, Math.ceil(SCOUT_MAX_S * plan.fps));
  try {
    for (let k = 0; k < total; k++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const frame = k * stride;
      await seekTo(video, Math.min(frameSeekTime(frame, sourceFps), video.duration - 1e-3));
      const result = layer.process(video, Math.round((frame / sourceFps) * 1000));
      options.onScout?.(k + 1, total);
      if (scout.push(result, frame / sourceFps)) break;
    }
    return scout.box();
  } finally {
    layer.dispose();
  }
}

/**
 * Walks through the clip like the analysis does (a seek to every frame, on a hidden video element, so the result does not depend on the
 * speed of the machine), runs the detector from the start and encodes the masked frames. The start of the clip is looked at first
 * (`scoutAthlete`), so that the frames before the detector is sure of the athlete are masked around where they jump, not left as they are.
 * Rejects with an `AbortError` when `signal` is aborted.
 */
export async function renderMaskedVideo(options: RenderOptions): Promise<RenderedVideo> {
  const { sourceFps, stride, signal } = options;
  const video = await loadVideo(options.url);
  const layer = new CanvasMaskLayer(options.config, options.fill);
  try {
    const { width, height } = exportSize(video.videoWidth, video.videoHeight);
    const plan = resultPlan(video.duration, sourceFps, stride);
    layer.detector.hint(await scoutAthlete(video, options, plan));
    let hidden = 0;
    const blob = await encodeMp4({
      width,
      height,
      fps: plan.fps,
      frames: plan.frames,
      signal,
      allowVp9: true,
      onProgress: (fraction) => options.onProgress?.(Math.round(fraction * plan.frames), plan.frames, hidden),
      drawFrame: async (k, ctx) => {
        const frame = k * stride;
        await seekTo(video, Math.min(frameSeekTime(frame, sourceFps), video.duration - 1e-3));
        if (hidesSomething(layer.process(video, Math.round((frame / sourceFps) * 1000)))) hidden++;
        // The picture as it is when the frame could not be read, like in front of the pose model.
        ctx.drawImage(layer.render(video), 0, 0, width, height);
      },
    });
    return { blob, frames: plan.frames, hidden };
  } finally {
    layer.dispose();
    disposeVideo(video);
  }
}
