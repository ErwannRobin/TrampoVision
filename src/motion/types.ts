import type { CameraType } from './config';

/** A small gray picture, row by row, intensities 0 (black) to 1 (white). The detector measures motion on this, not on the video. */
export interface GrayFrame {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * What the detector knows after one frame. The pictures are the size of the gray frame and are reused by the next call: copy
 * what has to outlive it.
 */
export interface MotionResult {
  width: number;
  height: number;
  /**
   * Vertical motion between this frame and the one before, -1 to 1 per pixel: how sure it is that something moves, and which way.
   * Negative is up, positive is down (the y of the picture), 0 is nothing that moves vertically in a way that is not noise.
   */
  motion: Float32Array;
  /** 0 to 1 per pixel: motion that went up and down through this pixel, in a column whose motion repeats like jumps. */
  evidence: Float32Array;
  /** 0 to 1 per column: how well the vertical motion in that column repeats at a jump's pace, going up and down and again. */
  rhythm: Float32Array;
  /**
   * The athlete mask, 0 to 1 per pixel: 1 keeps the picture, 0 hides it. All 1 while no jumping athlete is found (the detector
   * never hides the picture when it is not sure).
   */
  mask: Float32Array;
  /** True while a region with the movement of a jumping athlete is in the mask. */
  found: boolean;
  /** The jump period read from the moving columns, seconds; null while nothing repeats. */
  periodS: number | null;
  /** How well that period fits, 0 to 1 (the autocorrelation at the period). */
  rhythmFit: number;
  /** Mean of the mask: the share of the picture that stays visible. */
  coverage: number;
  /** Noise level of the frame difference this frame, intensity 0..1. */
  noise: number;
  /** How far the whole picture moved down since the last frame, in picture pixels: the shake of the camera, taken out of the motion. */
  shift: number;
  /** The camera: the kind of shot in use, how the picture moved since the last frame, and how far it wanders. */
  camera: {
    type: CameraType;
    /** Picture pixels, right and down positive; 0 when the move could not be told. */
    dx: number;
    dy: number;
    /** True when the move of the picture was told. */
    known: boolean;
    /** How fast the camera moves, shorter sides of the picture a second, smoothed (what tells a moving camera from a still one). */
    speed: number;
  };
}
