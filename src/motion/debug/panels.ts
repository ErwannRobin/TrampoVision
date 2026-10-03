import { buildWireframe, type Side } from '../../pose/skeleton';
import type { PoseDetection } from '../../pose/types';
import { alphaFromMask } from '../pixels';
import type { MotionResult } from '../types';

/*
 * The five panels of the debug view. They draw on footage of any brightness, so the colors are fixed, the same as the ones the skeleton
 * overlay of the app uses: blue for what rises (and the left of the body), orange for what falls (and the right), gold for the one mark
 * that is about the detector itself.
 */
const UP: [number, number, number] = [98, 176, 255];
const DOWN: [number, number, number] = [255, 154, 85];
const GOLD = '255, 201, 51';
const SIDE: Record<Side, string> = { left: '#62b0ff', right: '#ff9a55', center: '#f4f6f8' };
/** The width the panels are drawn at, pixels. The page scales them down with CSS. */
export const PANEL_WIDTH = 480;
/** How much the picture is darkened under the marks that are drawn on it. */
const SCRIM = 'rgba(0, 0, 0, 0.55)';

/** The motion map as RGBA: blue where something moves up, orange where it moves down, clear elsewhere; the surer, the stronger. */
export function motionRgba(motion: Float32Array, out: Uint8ClampedArray): void {
  for (let i = 0; i < motion.length; i++) {
    const m = motion[i];
    const [r, g, b] = m < 0 ? UP : DOWN;
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.round(Math.min(1, Math.abs(m)) * 255);
  }
}

/** A small canvas that holds a picture of the detector's size, to be stretched on a panel. */
class Scratch {
  readonly canvas = document.createElement('canvas');
  private image: ImageData | null = null;

  /** Fills it with RGBA made from a map, and returns the canvas. */
  paint(width: number, height: number, fill: (rgba: Uint8ClampedArray) => void): HTMLCanvasElement {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.image = null;
    }
    const ctx = this.canvas.getContext('2d')!;
    this.image ??= ctx.createImageData(width, height);
    fill(this.image.data);
    ctx.putImageData(this.image, 0, 0);
    return this.canvas;
  }
}

export interface PanelCanvases {
  original: HTMLCanvasElement;
  motion: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  masked: HTMLCanvasElement;
  skeleton: HTMLCanvasElement;
}

export interface PanelFrame {
  video: HTMLVideoElement;
  /** What the detector found; null when the frame could not be read. */
  result: MotionResult | null;
  /** The frame with the background painted over. */
  masked: HTMLCanvasElement;
  /** The picture the pose model was given: the masked frame, or the video as it is when the background is not hidden. */
  given: CanvasImageSource;
  /** What the pose model found in that picture; null when it did not run. */
  people: PoseDetection[] | null;
}

/** Draws the original frame, the motion map, the athlete mask, the masked frame and the skeleton. */
export class Panels {
  private readonly motionScratch = new Scratch();
  private readonly maskScratch = new Scratch();

  constructor(private readonly canvases: PanelCanvases) {}

  /** Gives every panel the shape of the video. */
  resize(videoWidth: number, videoHeight: number): void {
    const height = Math.max(1, Math.round((PANEL_WIDTH * videoHeight) / Math.max(1, videoWidth)));
    for (const canvas of Object.values(this.canvases)) {
      canvas.width = PANEL_WIDTH;
      canvas.height = height;
    }
  }

  draw({ video, result, masked, given, people }: PanelFrame): void {
    const { original, motion, mask, masked: maskedPanel, skeleton } = this.canvases;
    const w = original.width;
    const h = original.height;

    original.getContext('2d')!.drawImage(video, 0, 0, w, h);

    this.drawMotion(motion, video, result);
    this.drawMask(mask, result);
    maskedPanel.getContext('2d')!.drawImage(masked, 0, 0, w, h);

    const ctx = skeleton.getContext('2d')!;
    ctx.drawImage(given, 0, 0, w, h);
    ctx.fillStyle = SCRIM;
    ctx.fillRect(0, 0, w, h);
    if (people === null) note(ctx, 'The pose model is off', w, h);
    else if (people.length === 0) note(ctx, 'No person found', w, h);
    else for (const person of people) drawPerson(ctx, person, w, h);
  }

  /** The video, dimmed; on it what moves up (blue) and down (orange), and along the bottom how well each column repeats (gold). */
  private drawMotion(canvas: HTMLCanvasElement, video: HTMLVideoElement, result: MotionResult | null): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.fillStyle = SCRIM;
    ctx.fillRect(0, 0, w, h);
    if (!result) return;
    // The picture of the detector is stretched without smoothing: what is seen is what the detector had.
    const small = this.motionScratch.paint(result.width, result.height, (rgba) => motionRgba(result.motion, rgba));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    const column = w / result.width;
    const strip = Math.max(6, h * 0.025);
    for (let x = 0; x < result.width; x++) {
      ctx.fillStyle = `rgba(${GOLD}, ${Math.min(1, result.rhythm[x])})`;
      ctx.fillRect(x * column, h - strip, column + 0.5, strip);
    }
  }

  /** The mask as it is applied: white where the picture stays, black where it is hidden. */
  private drawMask(canvas: HTMLCanvasElement, result: MotionResult | null): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!result) return;
    const small = this.maskScratch.paint(result.width, result.height, (rgba) => alphaFromMask(result.mask, rgba));
    ctx.drawImage(small, 0, 0, w, h);
  }
}

function note(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = `500 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
}

/** One skeleton: the stick figure of the app (left blue, right orange), on the picture of the panel. */
function drawPerson(ctx: CanvasRenderingContext2D, person: PoseDetection, w: number, h: number): void {
  const wire = buildWireframe(person.landmarks.map((p) => ({ x: p.x * w, y: p.y * h, visibility: p.visibility })));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, w / 190);
  for (const side of ['center', 'left', 'right'] as const) {
    ctx.strokeStyle = SIDE[side];
    ctx.fillStyle = SIDE[side];
    ctx.beginPath();
    for (const bone of wire.bones) {
      if (bone.side !== side) continue;
      ctx.moveTo(bone.a.x, bone.a.y);
      ctx.lineTo(bone.b.x, bone.b.y);
    }
    ctx.stroke();
    for (const joint of wire.joints) {
      if (joint.side !== side || joint.name === 'head') continue;
      ctx.beginPath();
      ctx.arc(joint.p.x, joint.p.y, ctx.lineWidth * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (wire.head) {
    ctx.strokeStyle = SIDE.center;
    ctx.beginPath();
    ctx.arc(wire.head.x, wire.head.y, wire.headRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
