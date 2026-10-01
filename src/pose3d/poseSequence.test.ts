import { describe, expect, it } from 'vitest';
import type { WorldPoint } from '../pose/types';
import { POSE3D_COLUMNS, pose3dSequence } from './poseSequence';

const frame = (x: number): WorldPoint[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: x + i * 0.01, y: -0.1 * i, z: 0.5, visibility: 1 }));

describe('pose3dSequence', () => {
  const time = [0, 1, 2, 3];
  const world = [frame(0), frame(1), frame(2), frame(3)];
  const cycle = { takeoffTimeS: 0.5, landingTimeS: 2.5, complete: true };

  it('resamples the flight on the normalized time axis, hips-centered meters', () => {
    const seq = pose3dSequence(world, time, cycle, 5);
    expect(seq).not.toBeNull();
    expect(seq!.data).toHaveLength(5);
    expect(seq!.data[0]).toHaveLength(POSE3D_COLUMNS.length);
    expect(seq!.data.map((r) => r[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const x = POSE3D_COLUMNS.indexOf('nose_x');
    expect(seq!.data[0][x]).toBeCloseTo(0.5, 3);
    expect(seq!.data[4][x]).toBeCloseTo(2.5, 3);
    expect(seq!.data[0][POSE3D_COLUMNS.indexOf('nose_z')]).toBeCloseTo(0.5, 3);
  });

  it('is null for a flight cut off by the clip, without 3D or without a duration', () => {
    expect(pose3dSequence(world, time, { ...cycle, complete: false }, 5)).toBeNull();
    expect(pose3dSequence(undefined, time, cycle, 5)).toBeNull();
    expect(pose3dSequence([null, null, null, null], time, cycle, 5)).toBeNull();
    expect(pose3dSequence(world, time, { ...cycle, landingTimeS: 0.5 }, 5)).toBeNull();
  });

  it('leaves NaN where a joint was not measured', () => {
    const holes = world.map((f) => f.map((p, i) => (i === 0 ? { ...p, x: NaN } : p)));
    const seq = pose3dSequence(holes, time, cycle, 3)!;
    expect(seq.data[1][POSE3D_COLUMNS.indexOf('nose_x')]).toBeNaN();
    expect(seq.data[1][POSE3D_COLUMNS.indexOf('left_ear_x')]).not.toBeNaN();
  });
});
