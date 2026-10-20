import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { buildPoseSeries, toSeriesJson } from '../analysis/timeSeries';
import { syntheticRoutine } from '../analysis/testTracks';
import type { PoseTrack } from '../analysis/types';
import { chooseSources, mergeReadings, sameAthlete, pickBest, readSeries, writeSeries } from './best';

const bounces = () =>
  syntheticRoutine({ jumps: Array.from({ length: 14 }, () => ({ v0: 5 })), leadInS: 0.2, contactS: 0.3 }).track;

/** The saved analysis of a track, as a reader of the library would upload it. */
function saved(track: PoseTrack): string {
  return toSeriesJson(
    buildPoseSeries(computeAnalysis(track), track, {
      fileName: 'a.mp4',
      videoId: 'v-test',
      stride: 1,
      minVisibility: 0.4,
      calibration: null,
    }),
  );
}

/** The athlete is lost between `from` and `to` (as a share of the clip). */
function lostBetween(track: PoseTrack, from: number, to: number): PoseTrack {
  const n = track.frames.length;
  return { ...track, frames: track.frames.map((f, i) => (i >= from * n && i < to * n ? null : f)) };
}

describe('the best analysis of a clip', () => {
  const whole = bounces();
  const firstHalfLost = saved(lostBetween(whole, 0.05, 0.55));
  const secondHalfLost = saved(lostBetween(whole, 0.45, 0.95));

  it('keeps a first analysis', () => {
    const pick = pickBest(null, readSeries(firstHalfLost));
    expect(pick.choice).toBe('incoming');
  });

  it('keeps the stored analysis when the new one reads less of the clip', () => {
    const good = readSeries(saved(whole));
    const worse = readSeries(firstHalfLost);
    const pick = pickBest(good, worse);
    expect(pick.choice).toBe('stored');
    expect(pick.best).toBe(good);
  });

  it('replaces the stored analysis with a better one', () => {
    const pick = pickBest(readSeries(firstHalfLost), readSeries(saved(whole)));
    expect(pick.choice).toBe('incoming');
  });

  it('stitches two analyses that read different halves into one that reads more than both', () => {
    const a = readSeries(firstHalfLost);
    const b = readSeries(secondHalfLost);
    const pick = pickBest(a, b);
    expect(pick.choice).toBe('merged');
    expect(pick.best.completion.score).toBeGreaterThan(Math.max(a.completion.score, b.completion.score) + 0.2);
    // It is a series like any other: the Worker stores it and the app opens it.
    const again = readSeries(writeSeries(pick.best));
    expect(again.completion.score).toBeCloseTo(pick.best.completion.score, 2);
  });

  it('switches only at frames where both analyses show the same body', () => {
    const a = readSeries(firstHalfLost);
    const b = readSeries(secondHalfLost);
    const pick = chooseSources(a, b);
    // From the second analysis to the first at the start of the clip, then back: at most one change in this case.
    let changes = 0;
    for (let i = 1; i < pick.length; i++) if (pick[i] !== pick[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(2);
    // Another athlete in the second analysis (shifted far away): never mixed in.
    const shifted: PoseTrack = {
      ...whole,
      frames: whole.frames.map((f) => f && f.map((p) => ({ ...p, x: p.x + 400 }))),
    };
    const stranger = readSeries(saved(shifted));
    expect(sameAthlete(a, b)).toBe(true);
    expect(sameAthlete(a, stranger)).toBe(false);
    expect(mergeReadings(a, stranger)).toBeNull();
  });

  it('does not stitch analyses of different frames', () => {
    const a = readSeries(firstHalfLost);
    const shorter = { ...whole, times: whole.times.slice(0, -5), frames: whole.frames.slice(0, -5) };
    expect(mergeReadings(a, readSeries(saved(shorter)))).toBeNull();
  });
});
