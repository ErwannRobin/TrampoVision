import { describe, expect, it } from 'vitest';
import { computeAnalysis } from './computeAnalysis';
import { checkPose } from './poseCheck';
import { syntheticRoutine } from './testTracks';
import type { PoseTrack } from './types';

const check = (track: PoseTrack, options?: Parameters<typeof checkPose>[2]) =>
  checkPose(track, computeAnalysis(track), options);

describe('checking how well the pose model read the athlete', () => {
  it('finds nothing to read again in clean straight jumps', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 5 }, { v0: 5 }, { v0: 5 }] });
    const c = check(track);
    expect(c.flights).toHaveLength(3);
    expect(c.flights.every((f) => f.doubts.length === 0)).toBe(true);
    expect(c.count).toBe(0);
  });

  it('reads a somersault again, with a margin around it: the pose model is weakest upside down', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 5 }, { v0: 5, turns: 1 }, { v0: 5 }] });
    const c = check(track);
    expect(c.flights.map((f) => f.doubts)).toEqual([[], ['rotating'], []]);
    const { from, to } = c.flights[1];
    const pad = Math.round(0.2 * track.fps);
    expect(c.frames[from - pad]).toBe(1);
    expect(c.frames[to + pad]).toBe(1);
    expect(c.frames[from - pad - 1]).toBe(0);
    expect(c.count).toBe(to - from + 1 + 2 * pad);
  });

  it('trusts a clean somersault when rotation alone is not a doubt', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 5, turns: 1 }] });
    expect(check(track, { rotatingDeg: Infinity }).count).toBe(0);
  });

  it('reads again a flight the athlete was lost in, and the frames without them near the frames with them', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 5 }, { v0: 5 }], tailS: 3 });
    const c0 = check(track);
    const { from, to } = c0.flights[1];
    const mid = Math.round((from + to) / 2);
    const holes: PoseTrack = { ...track, frames: track.frames.map((p, i) => (Math.abs(i - mid) <= 3 ? null : p)) };
    const c = check(holes);
    expect(c.flights[1].doubts).toContain('missing');
    expect(c.flights[0].doubts).toEqual([]);
    expect(c.lostFrames).toBe(7);
    // Far from any reading of the athlete, a frame without them is not read again.
    const gone: PoseTrack = { ...track, frames: track.frames.map((p, i) => (i > to + 60 ? null : p)) };
    const g = check(gone);
    expect(g.frames[to + 60 + 5]).toBe(1);
    expect(g.frames[track.frames.length - 1]).toBe(0);
  });
});
