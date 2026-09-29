import type { JumpCycle } from '../analysis/jumpCycles';
import type { TwistFrames } from '../pose3d/twist';
import { valueAt } from './rotation';

/** Accumulated twist in degrees since the takeoff, at `samples` evenly spaced moments from takeoff to landing. Null without 3D. */
export function twistTrajectory(
  frames: TwistFrames | null,
  time: Float64Array,
  cycle: Pick<JumpCycle, 'takeoffTimeS' | 'landingTimeS'>,
  samples: number,
): number[] | null {
  if (!frames || cycle.takeoffTimeS === null || cycle.landingTimeS === null) return null;
  const t0 = cycle.takeoffTimeS;
  const base = valueAt(time, frames.angle, t0);
  if (base === null) return null;
  const out: number[] = [];
  for (let k = 0; k < samples; k++) {
    const v = valueAt(time, frames.angle, t0 + (k / (samples - 1)) * (cycle.landingTimeS - t0));
    out.push(v === null ? NaN : v - base);
  }
  return out.filter(Number.isFinite).length >= samples / 2 ? out : null;
}
