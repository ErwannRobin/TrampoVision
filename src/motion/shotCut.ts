import type { GrayFrame } from './types';

/** Gray levels are counted in this many bins to compare the look of two frames. */
const BINS = 32;
/** One pixel in this many (each way) is compared: a cut changes the whole picture, so a sample tells. */
const SAMPLE = 3;
/** Share of the picture whose gray level moved to another bin, above which two frames have not much in common. */
const HIST_CUT = 0.3;
/** Mean gray change per pixel that goes with a different histogram (0..1). A pan or a tilt moves this much per frame only on a busy scene at the very edge of what a camera does. */
const DIFF_WITH_HIST = 0.08;
/** Mean gray change per pixel that is a cut by itself: two scenes with the same lights (wide shot to wide shot from another angle). */
const DIFF_CUT = 0.22;

/**
 * Tells where a broadcast cuts from one shot to another (wide shot, close-up, replay): the picture changes all at once, where a camera
 * that pans or tilts changes it a little every frame and keeps the same lights. A cut is when both the histogram of gray levels and the
 * picture itself differ a lot from the frame before, or the picture alone does very much.
 *
 * Whatever the detector learned about the scene (where the athlete is, the camera, the zoom, who jumps) says nothing about the next one.
 */
export class ShotCutDetector {
  private previous: Float32Array | null = null;
  private histogram: Float32Array | null = null;
  private width = 0;
  private height = 0;
  /** The last two measures, for debugging and tuning (0..1 each). */
  lastHistogram = 0;
  lastDifference = 0;

  /** Takes the next frame (in order). True when it is the first of a new shot. */
  push(frame: GrayFrame): boolean {
    if (frame.width !== this.width || frame.height !== this.height) {
      this.width = frame.width;
      this.height = frame.height;
      this.previous = null;
    }
    const samples: number[] = [];
    const histogram = new Float32Array(BINS);
    for (let y = 0; y < frame.height; y += SAMPLE) {
      for (let x = 0; x < frame.width; x += SAMPLE) {
        const v = frame.data[y * frame.width + x];
        samples.push(v);
        histogram[Math.min(BINS - 1, Math.max(0, Math.floor(v * BINS)))]++;
      }
    }
    for (let i = 0; i < BINS; i++) histogram[i] /= samples.length;
    const now = Float32Array.from(samples);
    let cut = false;
    if (this.previous && this.histogram && this.previous.length === now.length) {
      let l1 = 0;
      for (let i = 0; i < BINS; i++) l1 += Math.abs(histogram[i] - this.histogram[i]);
      let diff = 0;
      for (let i = 0; i < now.length; i++) diff += Math.abs(now[i] - this.previous[i]);
      this.lastHistogram = l1 / 2;
      this.lastDifference = diff / now.length;
      cut = (this.lastHistogram > HIST_CUT && this.lastDifference > DIFF_WITH_HIST) || this.lastDifference > DIFF_CUT;
    }
    this.previous = now;
    this.histogram = histogram;
    return cut;
  }

  /** Forgets the frame before: another clip, or the same one from the start. */
  reset(): void {
    this.previous = null;
    this.histogram = null;
  }
}
