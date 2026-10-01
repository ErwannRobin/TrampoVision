import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { mannequinRoutine } from '../skills/testMannequin';
import { computeAnalysis } from './computeAnalysis';
import { plainOrientation, trackOrientation } from './orientation';
import { unwrapDegrees, wrapDegrees } from './signal';
import { addNoise, makeRng, syntheticRoutine } from './testTracks';
import type { PoseTrack } from './types';

/** A body turning at a steady rate with an optional change of rate (a tuck closing), as wrapped angles, one sample per frame. */
function spin(frames: number, degPerFrame: number, speedUp = 0): { truth: number[]; wrapped: number[] } {
  const truth: number[] = [];
  let a = 0;
  let rate = degPerFrame;
  for (let i = 0; i < frames; i++) {
    truth.push(a);
    a += rate;
    rate += speedUp;
  }
  return { truth, wrapped: truth.map(wrapDegrees) };
}

const flip = (wrapped: number[], from: number, to: number) =>
  wrapped.map((a, i) => (i >= from && i < to ? wrapDegrees(a + 180) : a));

describe('trackOrientation', () => {
  it('gives what unwrapDegrees gives on a clean track, and flips nothing', () => {
    for (const [rate, speedUp] of [
      [0, 0],
      [12, 0],
      [-18, 0],
      [8, 0.6],
      [40, 0],
    ]) {
      const { wrapped } = spin(60, rate, speedUp);
      const rnd = makeRng(5);
      const noisy = wrapped.map((a) => wrapDegrees(a + 2 * rnd()));
      const tracked = trackOrientation({ angle: noisy });
      expect(Array.from(tracked.orientation)).toEqual(Array.from(unwrapDegrees(noisy)));
      expect(tracked.flippedFrames).toBe(0);
      expect(tracked.flipRuns).toBe(0);
    }
  });

  it('does not take a fast real rotation for a flip', () => {
    // 60° a frame is far beyond a double somersault at 30 fps, and still not a flip.
    const { truth, wrapped } = spin(40, 60);
    const tracked = trackOrientation({ angle: wrapped });
    expect(tracked.flippedFrames).toBe(0);
    expect(tracked.orientation[39]).toBeCloseTo(truth[39], 6);
  });

  it('puts back a single flipped frame, a few, and a long stretch', () => {
    const { truth, wrapped } = spin(70, 14, 0.1);
    for (const [from, to] of [
      [30, 31],
      [30, 34],
      [25, 37],
      [10, 24],
    ]) {
      const tracked = trackOrientation({ angle: flip(wrapped, from, to) });
      for (let i = 0; i < truth.length; i++) expect(tracked.orientation[i]).toBeCloseTo(truth[i], 6);
      expect(tracked.flippedFrames).toBe(to - from);
      expect(tracked.flipRuns).toBe(1);
      // Without the repair the same series is off by half a turn or more somewhere.
      const plain = plainOrientation(flip(wrapped, from, to));
      const worst = Math.max(...truth.map((v, i) => Math.abs(plain.orientation[i] - v)));
      expect(worst).toBeGreaterThan(150);
    }
  });

  it('counts the separate stretches and handles a flip that lasts to the end of the clip', () => {
    const { truth, wrapped } = spin(80, 12);
    let bad = flip(wrapped, 15, 19);
    bad = flip(bad, 40, 47);
    const tracked = trackOrientation({ angle: bad });
    expect(tracked.flipRuns).toBe(2);
    expect(tracked.flippedFrames).toBe(11);
    expect(tracked.orientation[79]).toBeCloseTo(truth[79], 6);
    // From some point on the model stays flipped: the earlier frames are the reference, the rest is put back.
    const tail = trackOrientation({ angle: flip(wrapped, 50, 80) });
    for (let i = 0; i < 80; i++) expect(tail.orientation[i]).toBeCloseTo(truth[i], 6);
    expect(tail.flipRuns).toBe(1);
  });

  it('survives noise, gaps and several flips together', () => {
    const { truth, wrapped } = spin(120, 13, 0.05);
    const rnd = makeRng(9);
    let bad = wrapped.map((a) => wrapDegrees(a + 4 * rnd()));
    bad = flip(bad, 20, 22);
    bad = flip(bad, 50, 58);
    bad = flip(bad, 90, 91);
    const gap = bad.map((a, i) => (i >= 70 && i < 74 ? NaN : a));
    const tracked = trackOrientation({ angle: gap });
    for (let i = 0; i < 120; i++) {
      if (i >= 70 && i < 74) expect(Number.isNaN(tracked.orientation[i])).toBe(true);
      else expect(Math.abs(tracked.orientation[i] - truth[i])).toBeLessThan(10);
    }
    expect(tracked.flipRuns).toBe(3);
  });

  it('lets a witness tip a tie, but not outvote the physics', () => {
    const { truth, wrapped } = spin(60, 10);
    const bad = flip(wrapped, 20, 40);
    // A witness that follows the true direction agrees with the repair.
    const withWitness = trackOrientation({ angle: bad, line: wrapped, lineWeight: wrapped.map(() => 1) });
    for (let i = 0; i < 60; i++) expect(withWitness.orientation[i]).toBeCloseTo(truth[i], 6);
    // A witness that flips with the body (a whole-body flip) pulls the other way, and the smooth path still wins.
    const sameFlip = trackOrientation({
      angle: bad,
      line: bad,
      head: bad,
      lineWeight: bad.map(() => 1),
      headWeight: bad.map(() => 1),
    });
    for (let i = 0; i < 60; i++) expect(sameFlip.orientation[i]).toBeCloseTo(truth[i], 6);
  });

  it('copes with an empty or one-sample series', () => {
    expect(trackOrientation({ angle: [] }).orientation).toHaveLength(0);
    expect(trackOrientation({ angle: [NaN, NaN] }).flippedFrames).toBe(0);
    expect(trackOrientation({ angle: [NaN, 30, NaN] }).orientation[1]).toBe(30);
  });
});

/** Frames [from, to) of a track as the pose model would give them after a head/feet flip. */
function flipFrames(track: PoseTrack, from: number, to: number, mode: 'trunk' | 'whole'): PoseTrack {
  return {
    ...track,
    frames: track.frames.map((f, i) => {
      if (!f || i < from || i >= to) return f;
      if (mode === 'trunk') {
        // Hips and shoulders trade places; the head and the legs are where they were.
        const out: Keypoint[] = f.map((p) => ({ ...p }));
        out[LM.L_SHOULDER] = f[LM.L_HIP];
        out[LM.L_HIP] = f[LM.L_SHOULDER];
        out[LM.R_SHOULDER] = f[LM.R_HIP];
        out[LM.R_HIP] = f[LM.R_SHOULDER];
        return out;
      }
      const hx = (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2;
      const hy = (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2;
      return f.map((p) => ({ ...p, x: 2 * hx - p.x, y: 2 * hy - p.y }));
    }),
  };
}

describe('orientation in the analysis', () => {
  const routine = { jumps: [{ v0: 4.2 }, { v0: 5.2, turns: 2, driftM: 0.4 }, { v0: 4.6, turns: -1 }] };

  it('changes nothing on a clean track, and says so', () => {
    const { track } = syntheticRoutine(routine);
    for (const noisy of [track, addNoise(track, 1.5)]) {
      const on = computeAnalysis(noisy);
      const off = computeAnalysis(noisy, { repairOrientation: false });
      expect(Array.from(on.orientation)).toEqual(Array.from(off.orientation));
      expect(Array.from(on.lineOrientation)).toEqual(Array.from(off.lineOrientation));
      expect(on.meta.orientationFlippedFrames).toBe(0);
      expect(on.meta.orientationFlipRuns).toBe(0);
      expect(on.jumps.cycles.map((c) => c.quarterTurns)).toEqual([0, 8, -4]);
    }
  });

  it('counts the somersaults of a double through head/feet flips, with noise', () => {
    const { track, truth } = syntheticRoutine(routine);
    const flightFrames = (k: number) => [Math.round(truth.takeoff[k] * 30), Math.round(truth.landing[k] * 30)];
    const [t1, l1] = flightFrames(1);
    const cases: [number, number][] = [
      [t1 + 6, t1 + 7],
      [t1 + 10, t1 + 15],
      [t1 + 14, t1 + 24],
    ];
    expect(l1 - t1).toBeGreaterThan(30);
    let plainWrong = 0;
    for (const mode of ['trunk', 'whole'] as const) {
      for (const [from, to] of cases) {
        const bad = addNoise(flipFrames(track, from, to, mode), 1.2, 4);
        const repaired = computeAnalysis(bad);
        expect(
          repaired.jumps.cycles.map((c) => c.quarterTurns),
          `${mode} ${from}-${to}`,
        ).toEqual([0, 8, -4]);
        // A single flipped frame is already dropped as a glitch by the stabilizer; the longer stretches are the tracker's.
        if (to - from > 1) {
          expect(repaired.meta.orientationFlippedFrames, `${mode} ${from}-${to}`).toBeGreaterThanOrEqual(to - from - 2);
          expect(repaired.meta.orientationFlipRuns, `${mode} ${from}-${to}`).toBeGreaterThanOrEqual(1);
        }
        const plain = computeAnalysis(bad, { repairOrientation: false });
        if (plain.jumps.cycles.map((c) => c.quarterTurns).join() !== '0,8,-4') plainWrong++;
      }
    }
    // The test is only worth something if the flips do hurt without the repair.
    expect(plainWrong).toBeGreaterThanOrEqual(3);
  });

  it('keeps the body-line orientation consistent with the trunk, so the cross-check does not fail on a repaired flip', () => {
    const { track, truth } = syntheticRoutine({ jumps: [{ v0: 5.2, turns: 1 }] });
    const t = Math.round(truth.takeoff[0] * 30);
    const r = computeAnalysis(flipFrames(track, t + 8, t + 14, 'trunk'));
    const c = r.jumps.cycles[0];
    const i0 = Math.round(c.takeoffTimeS! * 30);
    const i1 = Math.round(c.landingTimeS! * 30);
    const trunk = r.orientation[i1] - r.orientation[i0];
    const line = r.lineOrientation[i1] - r.lineOrientation[i0];
    expect(Math.abs(trunk - 360)).toBeLessThan(40);
    expect(Math.abs(line - trunk)).toBeLessThan(30);
  });

  it('puts back the orientation of a mannequin somersault whose inverted frames are flipped', () => {
    const { track, truth } = mannequinRoutine({ jumps: [{ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }] });
    const t = truth.takeoff[0];
    const flipped = flipFrames(track, Math.round((t + 0.4) * 30), Math.round((t + 0.55) * 30), 'whole');
    const r = computeAnalysis(flipped);
    const plain = computeAnalysis(flipped, { repairOrientation: false });
    const end = Math.round((t + truth.flight[0]) * 30);
    const start = Math.round(t * 30);
    expect(Math.abs(r.orientation[end] - r.orientation[start] - 360)).toBeLessThan(50);
    expect(r.meta.orientationFlippedFrames).toBeGreaterThan(0);
    expect(plain.meta.orientationFlippedFrames).toBe(0);
  });
});
