import type { JumpCycle } from '../analysis/jumpCycles';
import type { WorldPoint } from '../pose/types';
import { SEQUENCE_JOINTS } from '../skills/frameShape';

/**
 * The 3D pose of one flight on the normalized time axis (0 = takeoff, 1 = landing), like the 2D jump sequence, so a reviewer can
 * turn the skeleton around and check the somersault and the twist by eye.
 */
export const POSE3D_FRAME =
  'Meters. Origin at the hip center, axes aligned with the camera: x to the right of the image, y down, z away from the camera. ' +
  'As measured by the model, so the body turns in this frame as it does in the video.';

export const POSE3D_COLUMNS = ['u', ...SEQUENCE_JOINTS.flatMap((j) => [`${j.name}_x`, `${j.name}_y`, `${j.name}_z`])];

export interface Pose3dSequence {
  samples: number;
  frame: string;
  columns: string[];
  /** Rows = samples; NaN (null in JSON) where a joint was not measured. Millimeter precision. */
  data: number[][];
}

const mm = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN);
const finite = (p: WorldPoint | undefined): p is WorldPoint =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** The 3D joints of one flight at `samples` evenly spaced moments. Null when the flight is cut off by the clip or no 3D was measured in it. */
export function pose3dSequence(
  world: (WorldPoint[] | null)[] | undefined,
  time: ArrayLike<number>,
  cycle: Pick<JumpCycle, 'takeoffTimeS' | 'landingTimeS' | 'complete'>,
  samples: number,
): Pose3dSequence | null {
  const n = time.length;
  if (!world || world.length !== n || n < 2) return null;
  if (!cycle.complete || cycle.takeoffTimeS === null || cycle.landingTimeS === null) return null;
  const t0 = cycle.takeoffTimeS;
  const dur = cycle.landingTimeS - t0;
  if (!(dur > 0)) return null;
  const data: number[][] = [];
  let any = false;
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1);
    const t = t0 + u * dur;
    let i = 0;
    while (i < n - 2 && time[i + 1] <= t) i++;
    const w = Math.min(Math.max((t - time[i]) / (time[i + 1] - time[i] || 1), 0), 1);
    const a = world[i];
    const b = world[i + 1];
    const row = [u];
    for (const j of SEQUENCE_JOINTS) {
      const pa = a?.[j.index];
      const pb = b?.[j.index];
      let p: [number, number, number] | null = null;
      if (finite(pa) && finite(pb)) p = [pa.x + (pb.x - pa.x) * w, pa.y + (pb.y - pa.y) * w, pa.z + (pb.z - pa.z) * w];
      else if (finite(pa) && w < 0.5) p = [pa.x, pa.y, pa.z];
      else if (finite(pb) && w >= 0.5) p = [pb.x, pb.y, pb.z];
      if (p) any = true;
      row.push(p ? mm(p[0]) : NaN, p ? mm(p[1]) : NaN, p ? mm(p[2]) : NaN);
    }
    data.push(row);
  }
  return any ? { samples, frame: POSE3D_FRAME, columns: POSE3D_COLUMNS, data } : null;
}
