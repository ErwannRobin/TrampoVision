import type { MotionConfig } from './config';
import { TrampolineMotionDetector } from './detector';
import { alphaFromMask, grayFromRgba, workSize } from './pixels';
import type { GrayFrame, MotionResult } from './types';

/** The picture is read this many times bigger than the gray picture and averaged down (see `grayFromRgba`). */
const SUPERSAMPLE = 3;
/** What shows where the picture is hidden: a flat, neutral gray, so that the pose model has nothing there to find. */
export const HIDDEN_FILL = 'rgb(128, 128, 128)';

/**
 * The part of the motion detector that needs a browser: it reads the frames of a video, runs the detector on them and paints the
 * masked picture. It is an interface so that what sits on it (`withMotionMask`) can be tested without one.
 */
export interface MaskLayer {
  /** Reads the video's current frame at `timeMs` (increasing). Null when the frame cannot be read: nothing is hidden then. */
  process(video: HTMLVideoElement, timeMs: number): MotionResult | null;
  /** The video's current frame with what the last `process` found out to be background painted over: a canvas the size of the video. */
  render(video: HTMLVideoElement): HTMLCanvasElement;
  dispose(): void;
}

interface Reader {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  gray: GrayFrame;
}

/** Keeps the picture where `mask` is opaque and paints `fill` behind the rest, the edge in between mixed as the mask says. */
function paintMasked(
  ctx: CanvasRenderingContext2D,
  picture: CanvasImageSource,
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  fill: string,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(picture, 0, 0, width, height);
  // "destination-in" multiplies what is on the canvas by the alpha of what is drawn: the mask, stretched (smoothly) to the picture.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, width, height);
  // "destination-over" paints behind what is there, so the hidden part shows the fill.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** The detector on the frames of a video element, and the masked picture on a canvas. */
export class CanvasMaskLayer implements MaskLayer {
  readonly detector: TrampolineMotionDetector;
  private reader: Reader | null = null;
  private last: MotionResult | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskImage: ImageData | null = null;
  private output: HTMLCanvasElement | null = null;

  /** What shows where the picture is hidden (a CSS color); can be changed between two frames. */
  fill: string;

  constructor(config?: Partial<MotionConfig>, fill: string = HIDDEN_FILL) {
    this.detector = new TrampolineMotionDetector(config);
    this.fill = fill;
  }

  process(video: HTMLVideoElement, timeMs: number): MotionResult | null {
    const reader = this.readerFor(video);
    if (!reader) return (this.last = null);
    const { canvas, ctx, gray } = reader;
    let rgba: Uint8ClampedArray;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return (this.last = null);
    }
    grayFromRgba(rgba, canvas.width, SUPERSAMPLE, gray);
    return (this.last = this.detector.push(gray, timeMs));
  }

  render(video: HTMLVideoElement): HTMLCanvasElement {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const output = (this.output ??= document.createElement('canvas'));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    const ctx = output.getContext('2d')!;
    const { last } = this;
    if (!last) {
      ctx.drawImage(video, 0, 0, width, height);
      return output;
    }
    const mask = (this.maskCanvas ??= document.createElement('canvas'));
    if (mask.width !== last.width || mask.height !== last.height) {
      mask.width = last.width;
      mask.height = last.height;
      this.maskImage = null;
    }
    const mctx = mask.getContext('2d')!;
    const image = (this.maskImage ??= mctx.createImageData(last.width, last.height));
    alphaFromMask(last.mask, image.data);
    mctx.putImageData(image, 0, 0);
    paintMasked(ctx, video, mask, width, height, this.fill);
    return output;
  }

  dispose(): void {
    this.reader = null;
    this.maskCanvas = null;
    this.maskImage = null;
    this.output = null;
    this.last = null;
  }

  /** The canvas the video is read on: made again when the video or its size changes. Null when the video has no picture yet. */
  private readerFor(video: HTMLVideoElement): Reader | null {
    if (!video.videoWidth || !video.videoHeight) return null;
    const gray = workSize(video.videoWidth, video.videoHeight, this.detector.config.workWidth);
    const kept = this.reader;
    if (kept && kept.video === video && kept.gray.width === gray.width && kept.gray.height === gray.height) return kept;
    const canvas = document.createElement('canvas');
    canvas.width = gray.width * SUPERSAMPLE;
    canvas.height = gray.height * SUPERSAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    return (this.reader = { video, canvas, ctx, gray: { ...gray, data: new Float32Array(gray.width * gray.height) } });
  }
}
