import { LM } from './landmarks';
import type { Keypoint, Point } from './types';

/**
 * What a person looks like, for telling athletes apart when their positions are not enough (they cross, one is lost
 * for a moment, a duplicate pose appears): the average color of the shirt and of the thighs. Both areas are found from
 * the landmarks, so the signature does not change when the athlete turns upside down in a somersault.
 */
export interface Signature {
  torso: Rgb | null;
  legs: Rgb | null;
}
type Rgb = [number, number, number];

/** A picture read back from a canvas (RGBA bytes), and the video-to-picture scale. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Picture pixels per video pixel. */
  scale: number;
}

/** Points sampled per area: enough to average out the noise of motion blur, few enough to be cheap. */
const TORSO_GRID = 6;
const LEG_STEPS = 8;
/** Fewest valid points for an area to count. */
const MIN_POINTS = 6;

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function average(pixels: Pixels, points: Point[]): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const p of points) {
    const x = Math.round(p.x * pixels.scale);
    const y = Math.round(p.y * pixels.scale);
    if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue;
    const i = (y * pixels.width + x) * 4;
    r += pixels.data[i];
    g += pixels.data[i + 1];
    b += pixels.data[i + 2];
    n++;
  }
  return n >= MIN_POINTS ? [r / n / 255, g / n / 255, b / n / 255] : null;
}

/** The colors of one person's shirt and thighs, or null when the landmarks do not say where they are. */
export function bodySignature(pixels: Pixels, kp: Keypoint[]): Signature | null {
  const ls = kp[LM.L_SHOULDER];
  const rs = kp[LM.R_SHOULDER];
  const lh = kp[LM.L_HIP];
  const rh = kp[LM.R_HIP];
  if (!ls || !rs || !lh || !rh) return null;

  // The inside of the shirt: a grid across the quad shoulders-hips, kept away from its edges (the arms, the background).
  const torso: Point[] = [];
  for (let i = 0; i < TORSO_GRID; i++) {
    for (let j = 0; j < TORSO_GRID; j++) {
      const u = 0.2 + (0.6 * i) / (TORSO_GRID - 1);
      const v = 0.2 + (0.6 * j) / (TORSO_GRID - 1);
      torso.push(lerp(lerp(ls, rs, u), lerp(lh, rh, u), v));
    }
  }
  const legs: Point[] = [];
  for (const [hip, knee] of [
    [lh, kp[LM.L_KNEE]],
    [rh, kp[LM.R_KNEE]],
  ] as const) {
    if (!knee) continue;
    for (let i = 0; i < LEG_STEPS; i++) legs.push(lerp(hip, knee, 0.15 + (0.6 * i) / (LEG_STEPS - 1)));
  }
  const signature = { torso: average(pixels, torso), legs: average(pixels, legs) };
  return signature.torso || signature.legs ? signature : null;
}

const rgbDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3);

/** How different two people look, 0 (the same colors) to 1; null when there is nothing to compare. */
export function signatureDistance(a: Signature, b: Signature): number | null {
  const parts: number[] = [];
  if (a.torso && b.torso) parts.push(rgbDistance(a.torso, b.torso));
  if (a.legs && b.legs) parts.push(rgbDistance(a.legs, b.legs));
  return parts.length ? parts.reduce((s, d) => s + d, 0) / parts.length : null;
}

/** The newest signature enters the running one a little: clothes do not change, light and blur do. */
export function blendSignature(old: Signature, next: Signature, share: number): Signature {
  const mix = (a: Rgb | null, b: Rgb | null): Rgb | null =>
    a && b ? [a[0] + share * (b[0] - a[0]), a[1] + share * (b[1] - a[1]), a[2] + share * (b[2] - a[2])] : (a ?? b);
  return { torso: mix(old.torso, next.torso), legs: mix(old.legs, next.legs) };
}

/** Reads the current picture of a video at a small size, for `bodySignature`. Null where a canvas is not available. */
export function createPixelReader(
  video: HTMLVideoElement,
  width: number,
  maxWidth = 320,
): (() => Pixels | null) | null {
  if (typeof document === 'undefined') return null;
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return () => {
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { data, width: w, height: h, scale };
    } catch {
      return null;
    }
  };
}
