import { describe, expect, it } from 'vitest';
import { keepAthletes, mergeTracks } from './athletes';
import type { PoseTrack } from './types';

const kp = [{ x: 0, y: 0, visibility: 1 }];
const track = (found: number, total = 10): PoseTrack =>
  ({ frames: Array.from({ length: total }, (_, i) => (i < found ? kp : null)) }) as unknown as PoseTrack;

describe('keepAthletes', () => {
  it('keeps the people who jump, in order, and drops those who do not', () => {
    const [a, coach, b] = [track(10), track(10), track(10)];
    const jumps = new Map([
      [a, 5],
      [coach, 0],
      [b, 4],
    ]);
    expect(keepAthletes([a, coach, b], (t) => jumps.get(t) ?? 0)).toEqual([a, b]);
  });

  it('drops somebody who was found in a few frames only', () => {
    const [a, passer] = [track(10), track(1)];
    expect(keepAthletes([a, passer], () => 3)).toEqual([a]);
  });

  it('keeps the track with the most poses when nobody jumps', () => {
    const [a, b] = [track(3), track(8)];
    expect(keepAthletes([a, b], () => 0)).toEqual([b]);
  });
});

describe('mergeTracks', () => {
  const pose = (v: number) => [{ x: v, y: 0, visibility: v }];
  const tr = (frames: (ReturnType<typeof pose> | null)[]): PoseTrack =>
    ({ frames, world: frames.map((f) => (f ? [{ x: f[0].x, y: 0, z: 0 }] : null)) }) as unknown as PoseTrack;

  it('fills the frames one track missed with the other', () => {
    const merged = mergeTracks([tr([pose(0.9), null, null]), tr([null, pose(0.8), null])]);
    expect(merged.frames).toEqual([pose(0.9), pose(0.8), null]);
    expect(merged.world?.map((w) => w?.[0].x ?? null)).toEqual([0.9, 0.8, null]);
  });

  it('keeps the surest pose when both tracks have one', () => {
    const merged = mergeTracks([tr([pose(0.5)]), tr([pose(0.7)])]);
    expect(merged.frames).toEqual([pose(0.7)]);
  });

  it('gives a single track back as is', () => {
    const a = tr([pose(1)]);
    expect(mergeTracks([a])).toBe(a);
  });
});
