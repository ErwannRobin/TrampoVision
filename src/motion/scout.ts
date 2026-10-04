import type { Box, MotionResult } from './types';

/** After the athlete is found, the boxes seen over this long are put together: the athlete goes through all the heights of a jump in it, seconds. */
export const SCOUT_SETTLE_S = 2.2;
/** The look ahead gives up when no athlete is found in this much of the clip, seconds. */
export const SCOUT_MAX_S = 20;

/**
 * The look ahead at the start of a clip. The detector needs two and a half jumps to be sure of the athlete, so its first frames are shown
 * as they are; a clip that is read whole can be run twice, and the first run says where the athlete is for the frames of the second that
 * come before the detector is sure (`TrampolineMotionDetector.hint`). It gathers what the first run finds: from the moment an athlete is
 * found, the boxes around them, put together over `SCOUT_SETTLE_S` seconds, are the place they jump in.
 */
export class AthleteScout {
  private foundAtS: number | null = null;
  private union: Box | null = null;

  /** Takes what the detector said about a frame at `timeS`; true when there is nothing more to wait for (the place is known). */
  push(result: MotionResult | null, timeS: number): boolean {
    if (result?.found) {
      this.foundAtS ??= timeS;
      for (const box of result.athletes) this.union = this.union ? merge(this.union, box) : { ...box };
    }
    return this.foundAtS !== null && timeS - this.foundAtS >= SCOUT_SETTLE_S;
  }

  /** Where the athlete jumps, or null when no athlete was found. */
  box(): Box | null {
    return this.union ? { ...this.union } : null;
  }
}

const merge = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});
