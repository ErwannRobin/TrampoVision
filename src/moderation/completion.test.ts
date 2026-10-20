import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { syntheticRoutine } from '../analysis/testTracks';
import type { PoseTrack } from '../analysis/types';
import { completion, completionBadge } from './completion';

const bounces = (count: number, leadInS: number, tailS: number) =>
  syntheticRoutine({ jumps: Array.from({ length: count }, () => ({ v0: 5 })), leadInS, contactS: 0.3, tailS });

const duration = (track: PoseTrack) => track.times.length / track.fps;

describe('completion of a shared clip', () => {
  it('is near 100% for a clip that is bounces from end to end', () => {
    const { track } = bounces(8, 0.2, 0.2);
    const c = completion(computeAnalysis(track));
    expect(c.jumps).toBe(8);
    expect(c.found).toBe(1);
    expect(c.score).toBeGreaterThan(0.9);
  });

  it('leaves out the time before the first take-off and after the last landing', () => {
    const { track, truth } = bounces(6, 4, 4);
    const c = completion(computeAnalysis(track));
    const expected = (truth.landing.at(-1)! - truth.takeoff[0]) / duration(track);
    expect(c.score).toBeCloseTo(expected, 1);
    expect(c.score).toBeLessThan(0.7);
    expect(c.found).toBe(1);
  });

  it('drops the frames where the athlete is lost', () => {
    const { track } = bounces(8, 0.2, 0.2);
    const whole = completion(computeAnalysis(track)).score;
    const n = track.frames.length;
    // A second and a half without anybody, in the middle of the run.
    const lost = Math.round(1.5 * track.fps);
    const frames = track.frames.map((f, i) => (i >= n / 2 && i < n / 2 + lost ? null : f));
    const c = completion(computeAnalysis({ ...track, frames }));
    expect(c.found).toBeCloseTo(1 - lost / n, 2);
    expect(c.score).toBeLessThan(whole - (lost / n) * 0.8);
  });

  it('gives nothing for a single jump or for no jump', () => {
    expect(completion(computeAnalysis(bounces(1, 1, 1).track)).score).toBe(0);
    const { track } = bounces(1, 1, 1);
    const still = { ...track, frames: track.frames.map(() => track.frames[0]) };
    expect(completion(computeAnalysis(still))).toMatchObject({ score: 0, jumps: 0, found: 1 });
  });

  it('colors the score', () => {
    expect(completionBadge(0.93)).toEqual({ text: 'Analyzed 93%', tone: 'ok' });
    expect(completionBadge(0.6).tone).toBe('warn');
    expect(completionBadge(0.2).tone).toBe('danger');
  });
});
