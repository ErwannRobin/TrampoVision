import { buildWireframe, type Side } from '../../pose/skeleton';
import type { PoseDetection } from '../../pose/types';
import { alphaFromMask } from '../pixels';
import type { MotionResult } from '../types';

/*
 * The panels of the debug view. They draw on footage of any brightness, so the colors are fixed, the same as the ones the skeleton
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
  /** What the pose models were given: the frame, or the view of the athlete when it is zoomed or turned. */
  given: HTMLCanvasElement;
}

export interface PanelFrame {
  video: HTMLVideoElement;
  /** What the detector found; null when the frame could not be read. */
  result: MotionResult | null;
  /** The frame with the background painted over. */
  masked: HTMLCanvasElement;
  /** The picture the pose models were given: the masked frame, or the video as it is when the background is not hidden. */
  given: CanvasImageSource;
  /** The view of the athlete the pose models were given (zoomed, turned), or null when they were given the picture `given` as it is. */
  view: CanvasImageSource | null;
}

/** Draws the original frame, the motion map, the athlete mask, the masked frame, what the pose models were given, and each model's skeletons. */
export class Panels {
  private readonly motionScratch = new Scratch();
  private readonly maskScratch = new Scratch();
  private width = PANEL_WIDTH;
  private height = Math.round((PANEL_WIDTH * 9) / 16);

  constructor(private readonly canvases: PanelCanvases) {
    this.clear();
  }

  /** Gives every panel the shape of the video; `skeletons` are the panels of the pose models. */
  resize(videoWidth: number, videoHeight: number, skeletons: HTMLCanvasElement[] = []): void {
    this.height = Math.max(1, Math.round((PANEL_WIDTH * videoHeight) / Math.max(1, videoWidth)));
    for (const canvas of [...Object.values(this.canvases), ...skeletons]) this.shape(canvas);
  }

  /** Gives a panel the shape of the video (a pose model's, added while a video is open). */
  shape(canvas: HTMLCanvasElement): void {
    canvas.width = this.width;
    canvas.height = this.height;
  }

  /** Black panels, the shape of a wide video: there is no video. */
  clear(skeletons: HTMLCanvasElement[] = []): void {
    this.height = Math.round((PANEL_WIDTH * 9) / 16);
    for (const canvas of [...Object.values(this.canvases), ...skeletons]) {
      this.shape(canvas);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  draw({ video, result, masked, given, view }: PanelFrame): void {
    const { original, motion, mask, masked: maskedPanel, given: givenPanel } = this.canvases;
    const w = original.width;
    const h = original.height;

    original.getContext('2d')!.drawImage(video, 0, 0, w, h);

    this.drawMotion(motion, video, result);
    this.drawMask(mask, result);
    maskedPanel.getContext('2d')!.drawImage(masked, 0, 0, w, h);
    this.drawGiven(givenPanel, view ?? given);
  }

  /**
   * A pose model's panel: the picture it was given, dimmed, and the people it found on it. `athlete` are the people who jump, drawn in
   * colour; the others are faint. Null `people` writes `idle` instead (the model is loading, or did not load).
   */
  drawSkeletons(
    canvas: HTMLCanvasElement,
    given: CanvasImageSource,
    people: PoseDetection[] | null,
    athlete: PoseDetection[] | null,
    idle = 'The model is not loaded',
  ): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.drawImage(given, 0, 0, w, h);
    ctx.fillStyle = SCRIM;
    ctx.fillRect(0, 0, w, h);
    if (people === null) note(ctx, idle, w, h);
    else if (people.length === 0) note(ctx, 'No person found', w, h);
    else for (const person of people) drawPerson(ctx, person, w, h, athlete === null || athlete.includes(person));
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
    // The box of the athlete: what the mask keeps, before its margin.
    ctx.strokeStyle = `rgb(${GOLD})`;
    ctx.lineWidth = Math.max(1.5, w / 320);
    const sx = w / result.width;
    const sy = h / result.height;
    for (const box of result.athletes) {
      ctx.strokeRect(box.x0 * sx, box.y0 * sy, (box.x1 - box.x0 + 1) * sx, (box.y1 - box.y0 + 1) * sy);
    }
    // The skeletons the pose model saw in the frame before, which the mask keeps as well (`seeBodies`).
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.setLineDash([6, 4]);
    for (const box of result.bodies) {
      ctx.strokeRect(box.x0 * sx, box.y0 * sy, (box.x1 - box.x0 + 1) * sx, (box.y1 - box.y0 + 1) * sy);
    }
    ctx.restore();
    const column = w / result.width;
    const strip = Math.max(6, h * 0.025);
    for (let x = 0; x < result.width; x++) {
      ctx.fillStyle = `rgba(${GOLD}, ${Math.min(1, result.rhythm[x])})`;
      ctx.fillRect(x * column, h - strip, column + 0.5, strip);
    }
  }

  /** What the pose model was given, in the frame of the panel: a view that is not the shape of the frame (a square) is fitted inside it on black. */
  private drawGiven(canvas: HTMLCanvasElement, source: CanvasImageSource): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const size = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
    const sw = size.videoWidth ?? size.width ?? w;
    const sh = size.videoHeight ?? size.height ?? h;
    const fit = Math.min(w / sw, h / sh);
    ctx.drawImage(source, (w - sw * fit) / 2, (h - sh * fit) / 2, sw * fit, sh * fit);
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

/** One skeleton: the stick figure of the app (left blue, right orange), on the picture of the panel; faint when it is not the person who jumps. */
function drawPerson(
  ctx: CanvasRenderingContext2D,
  person: PoseDetection,
  w: number,
  h: number,
  athlete: boolean,
): void {
  const wire = buildWireframe(person.landmarks.map((p) => ({ x: p.x * w, y: p.y * h, visibility: p.visibility })));
  ctx.save();
  if (!athlete) ctx.globalAlpha = 0.3;
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
