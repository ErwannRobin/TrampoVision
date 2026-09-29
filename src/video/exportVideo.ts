import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { disposeVideo, frameSeekTime, loadVideo, seekTo } from './frames';
import { drawCalibration, drawOverlay, type CalibrationDraw, type OverlayOptions } from './overlay';

/**
 * Renders the video with every visible annotation burned in and encodes it to H.264 MP4, entirely in the
 * browser (WebCodecs). Frames are produced by seeking, exactly like the analysis, so the result does not
 * depend on machine speed and matches what the player shows frame for frame.
 */

/** The overlay is laid out for a picture about this wide (CSS px); it is scaled to the export size. */
const REFERENCE_WIDTH = 960;
const MAX_LONG_SIDE = 1920;

export interface ExportOptions {
  url: string;
  fps: number;
  result: AnalysisResult | null;
  skills: SkillAnalysis | null;
  overlay: OverlayOptions;
  calibration: CalibrationDraw | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const canExportVideo = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** H.264 needs even dimensions; very large videos are scaled down to keep encoding fast. */
export function exportSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Highest AVC level the encoder accepts for this size (level 4.0 covers 1080p30, 5.1 covers the rest). */
async function pickConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  const bitrate = Math.round(Math.min(20_000_000, Math.max(2_000_000, width * height * Math.min(fps, 60) * 0.1)));
  for (const codec of ['avc1.640028', 'avc1.640033', 'avc1.4d0033', 'avc1.42001f']) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  throw new Error('This browser cannot encode H.264 video.');
}

export async function exportAnnotatedVideo(opts: ExportOptions): Promise<Blob> {
  if (!canExportVideo()) throw new Error('This browser cannot export video (WebCodecs is not available).');
  const { fps, result, skills, overlay, calibration, signal } = opts;
  const video = await loadVideo(opts.url);
  let encoder: VideoEncoder | null = null;
  try {
    const { width, height } = exportSize(video.videoWidth, video.videoHeight);
    const total = Math.max(1, Math.floor(video.duration * fps));
    const config = await pickConfig(width, height, fps);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing surface for the export.');

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
    });
    let encodeError: Error | null = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (encodeError = e),
    });
    encoder.configure(config);

    const cssWidth = REFERENCE_WIDTH;
    const cssHeight = (REFERENCE_WIDTH * height) / width;
    const scale = width / cssWidth;
    const frameUs = 1e6 / fps;

    for (let k = 0; k < total; k++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      const time = Math.min(frameSeekTime(k, fps), video.duration - 1e-3);
      await seekTo(video, time);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(video, 0, 0, width, height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (result)
        drawOverlay(ctx, cssWidth, cssHeight, result, sampleIndexAt(result.meta, time), overlay, skills, false);
      if (calibration) drawCalibration(ctx, cssWidth, cssHeight, video.videoWidth, video.videoHeight, calibration);

      const frame = new VideoFrame(canvas, { timestamp: Math.round(k * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: k % 60 === 0 });
      frame.close();
      // Keep the encoder queue short so memory stays flat on long videos.
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      opts.onProgress?.((k + 1) / total);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    disposeVideo(video);
  }
}
