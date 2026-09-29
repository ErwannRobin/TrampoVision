import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult, PoseTrack } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { drawPose3D, twistSinceTakeoff, type View } from '../pose3d/draw';
import type { TwistAnalysis } from '../pose3d/twist';
import { cssVar, pose3dColors } from '../ui/theme';
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

interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Paints frame `k` into the (already sized) canvas. */
  drawFrame: (k: number, ctx: CanvasRenderingContext2D) => Promise<void> | void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Encodes `frames` painted canvases as an H.264 MP4. Shared by every export. */
async function encodeMp4(opts: EncodeOptions): Promise<Blob> {
  if (!canExportVideo()) throw new Error('This browser cannot export video (WebCodecs is not available).');
  const { width, height, fps, frames, signal } = opts;
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
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  try {
    encoder.configure(config);
    const frameUs = 1e6 / fps;
    for (let k = 0; k < frames; k++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      await opts.drawFrame(k, ctx);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(k * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: k % 60 === 0 });
      frame.close();
      // Keep the encoder queue short so memory stays flat on long videos.
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      opts.onProgress?.((k + 1) / frames);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

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

/** Paints the current video frame at (x, 0) in a w x h area, with the overlay and the trampoline outline on top. */
function paintAnnotated(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  time: number,
  x: number,
  w: number,
  h: number,
  o: Pick<ExportOptions, 'result' | 'skills' | 'overlay' | 'calibration'>,
) {
  const cssWidth = REFERENCE_WIDTH;
  const cssHeight = (REFERENCE_WIDTH * h) / w;
  const scale = w / cssWidth;
  ctx.drawImage(video, x, 0, w, h);
  ctx.setTransform(scale, 0, 0, scale, x, 0);
  if (o.result)
    drawOverlay(ctx, cssWidth, cssHeight, o.result, sampleIndexAt(o.result.meta, time), o.overlay, o.skills, false);
  if (o.calibration) drawCalibration(ctx, cssWidth, cssHeight, video.videoWidth, video.videoHeight, o.calibration);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export async function exportAnnotatedVideo(opts: ExportOptions): Promise<Blob> {
  const { fps } = opts;
  const video = await loadVideo(opts.url);
  try {
    const { width, height } = exportSize(video.videoWidth, video.videoHeight);
    return await encodeMp4({
      width,
      height,
      fps,
      frames: Math.max(1, Math.floor(video.duration * fps)),
      signal: opts.signal,
      onProgress: opts.onProgress,
      drawFrame: async (k, ctx) => {
        const time = Math.min(frameSeekTime(k, fps), video.duration - 1e-3);
        await seekTo(video, time);
        paintAnnotated(ctx, video, time, 0, width, height, opts);
      },
    });
  } finally {
    disposeVideo(video);
  }
}

export interface Export3DOptions {
  track: PoseTrack;
  result: AnalysisResult;
  twist: TwistAnalysis;
  /** Takeoff sample of the selected jump, which the twist dial is measured from. */
  takeoff: number | null;
  view: View;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
/** The 3D scene is laid out for a picture this tall (CSS px) and scaled to the export size. */
const SCENE_CSS_HEIGHT = 360;

/** Paints the 3D skeleton of analysis sample `i` (plus a time/twist readout) in a w x h area at (x, 0). */
function paintPose3D(
  ctx: CanvasRenderingContext2D,
  i: number,
  x: number,
  w: number,
  h: number,
  o: Omit<Export3DOptions, 'onProgress' | 'signal'>,
) {
  const colors = pose3dColors();
  const scale = h / SCENE_CSS_HEIGHT;
  const cssWidth = w / scale;
  ctx.fillStyle = cssVar('--surface', '#fff');
  ctx.fillRect(x, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, 0, w, h);
  ctx.clip();
  ctx.setTransform(scale, 0, 0, scale, x, 0);
  drawPose3D(ctx, cssWidth, SCENE_CSS_HEIGHT, {
    world: o.track.world?.[i] ?? null,
    twist: o.twist,
    takeoff: o.takeoff,
    i,
    view: o.view,
    colors,
  });
  const rel = twistSinceTakeoff(o.twist, o.takeoff, i);
  const sign = rel !== null && rel < 0 ? '−' : '+';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = colors.ink;
  ctx.textAlign = 'left';
  ctx.fillText(
    `${o.result.time[i].toFixed(2)} s` + (rel !== null ? ` · twist ${sign}${Math.abs(Math.round(rel))}°` : ''),
    12,
    22,
  );
  ctx.restore();
}

/**
 * The analysis without the footage: the 3D skeleton (with torso, long axis and twist dial) drawn from the
 * estimated 3D landmarks, one frame per analyzed sample, on a plain background. It needs no video.
 */
export function exportPose3DVideo(opts: Export3DOptions): Promise<Blob> {
  return encodeMp4({
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    fps: opts.result.meta.fps,
    frames: opts.result.meta.count,
    signal: opts.signal,
    onProgress: opts.onProgress,
    drawFrame: (i, ctx) => paintPose3D(ctx, i, 0, SCENE_WIDTH, SCENE_HEIGHT, opts),
  });
}

const SIDE_BY_SIDE_MAX_HEIGHT = 720;

export type ExportSideBySideOptions = ExportOptions &
  Omit<Export3DOptions, 'result' | 'onProgress' | 'signal'> & {
    result: AnalysisResult;
  };

/** The annotated video on the left, the 3D skeleton of the same instant on the right (a square panel). */
export async function exportSideBySideVideo(opts: ExportSideBySideOptions): Promise<Blob> {
  const { fps, result } = opts;
  const video = await loadVideo(opts.url);
  try {
    const full = exportSize(video.videoWidth, video.videoHeight);
    const height = Math.min(full.height, SIDE_BY_SIDE_MAX_HEIGHT);
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const videoWidth = even((height * video.videoWidth) / video.videoHeight);
    return await encodeMp4({
      width: videoWidth + height,
      height,
      fps,
      frames: Math.max(1, Math.floor(video.duration * fps)),
      signal: opts.signal,
      onProgress: opts.onProgress,
      drawFrame: async (k, ctx) => {
        const time = Math.min(frameSeekTime(k, fps), video.duration - 1e-3);
        await seekTo(video, time);
        paintAnnotated(ctx, video, time, 0, videoWidth, height, opts);
        paintPose3D(ctx, sampleIndexAt(result.meta, time), videoWidth, height, height, opts);
      },
    });
  } finally {
    disposeVideo(video);
  }
}

/** Offers a blob to the user as a file download. */
export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
