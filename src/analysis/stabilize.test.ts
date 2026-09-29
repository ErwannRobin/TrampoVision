import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import { estimateCom } from './com';
import { JOINT_STATE, stabilizePose } from './stabilize';
import { addNoise, syntheticRoutine } from './testTracks';
import type { PoseTrack } from './types';

const oneJump = (extra: Partial<Parameters<typeof syntheticRoutine>[0]> = {}) =>
  syntheticRoutine({ jumps: [{ v0: 5 }], ...extra });

const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const cloneTrack = (t: PoseTrack): PoseTrack => ({ ...t, frames: t.frames.map((f) => f && f.map((p) => ({ ...p }))) });

describe('stabilizePose', () => {
  it('leaves a clean motion (including the apex) essentially untouched', () => {
    const { track } = oneJump();
    const s = stabilizePose(track);
    let worst = 0;
    for (let i = 0; i < track.frames.length; i++) {
      const raw = estimateCom(track.frames[i]!)!;
      const out = estimateCom(s.landmarks[i]!)!;
      worst = Math.max(worst, Math.abs(raw.y - out.y), Math.abs(raw.x - out.x));
    }
    expect(worst).toBeLessThan(1.5); // px, at 100 px/m
    expect(s.stats.spikesRejected).toBe(0);
    expect(s.stats.missing).toBe(0);
  });

  it('reduces jitter using neighbouring frames', () => {
    const { track } = oneJump({ fps: 60 });
    const noisy = addNoise(track, 2.5);
    const s = stabilizePose(noisy);
    const k = LM.L_KNEE;
    const before: number[] = [];
    const after: number[] = [];
    for (let i = 5; i < track.frames.length - 5; i++) {
      before.push(noisy.frames[i]![k].y - track.frames[i]![k].y);
      after.push(s.landmarks[i]![k].y - track.frames[i]![k].y);
    }
    expect(rms(after)).toBeLessThan(rms(before) * 0.6);
  });

  it('removes one-frame and two-frame glitches and marks them corrected', () => {
    const { track } = oneJump();
    const bad = cloneTrack(track);
    bad.frames[15]![LM.L_WRIST] = { x: bad.frames[15]![LM.L_WRIST].x + 140, y: bad.frames[15]![LM.L_WRIST].y - 90, visibility: 0.95 };
    for (const i of [30, 31]) bad.frames[i]![LM.R_KNEE] = { x: bad.frames[i]![LM.R_KNEE].x - 120, y: bad.frames[i]![LM.R_KNEE].y + 100, visibility: 0.9 };
    const s = stabilizePose(bad);
    expect(Math.hypot(s.landmarks[15]![LM.L_WRIST].x - track.frames[15]![LM.L_WRIST].x, s.landmarks[15]![LM.L_WRIST].y - track.frames[15]![LM.L_WRIST].y)).toBeLessThan(6);
    for (const i of [30, 31]) {
      expect(Math.hypot(s.landmarks[i]![LM.R_KNEE].x - track.frames[i]![LM.R_KNEE].x, s.landmarks[i]![LM.R_KNEE].y - track.frames[i]![LM.R_KNEE].y)).toBeLessThan(8);
      expect(s.state[LM.R_KNEE][i]).toBe(JOINT_STATE.corrected);
    }
    expect(s.state[LM.L_WRIST][15]).toBe(JOINT_STATE.corrected);
    expect(s.state[LM.L_WRIST][14]).toBe(JOINT_STATE.measured);
    expect(s.stats.spikesRejected).toBe(3);
  });

  it('does not mistake fast real motion (a double somersault) for glitches', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 4.6, turns: 2 }] });
    const s = stabilizePose(track);
    expect(s.stats.spikesRejected).toBe(0);
    expect(s.stats.jumpFrames).toBe(0);
  });

  it('ignores low-confidence garbage and bridges the gap', () => {
    const { track } = oneJump();
    const bad = cloneTrack(track);
    for (let i = 12; i <= 15; i++) bad.frames[i]![LM.R_ELBOW] = { x: 10, y: 10, visibility: 0.1 };
    const s = stabilizePose(bad);
    for (let i = 12; i <= 15; i++) {
      expect(s.state[LM.R_ELBOW][i]).toBe(JOINT_STATE.interpolated);
      expect(Math.hypot(s.landmarks[i]![LM.R_ELBOW].x - track.frames[i]![LM.R_ELBOW].x, s.landmarks[i]![LM.R_ELBOW].y - track.frames[i]![LM.R_ELBOW].y)).toBeLessThan(4);
      expect(s.score[LM.R_ELBOW][i]).toBeLessThan(0.6); // filled samples never look as sure as measured ones
    }
    expect(s.state[LM.R_ELBOW][11]).toBe(JOINT_STATE.measured);
  });

  it('leaves long gaps missing instead of inventing a path', () => {
    const { track } = oneJump({ fps: 30 });
    const bad = cloneTrack(track);
    for (let i = 10; i < 30; i++) bad.frames[i]![LM.R_WRIST].visibility = 0.05;
    const s = stabilizePose(bad);
    expect(s.state[LM.R_WRIST][20]).toBe(JOINT_STATE.missing);
    expect(Number.isNaN(s.landmarks[20]![LM.R_WRIST].x)).toBe(true);
    expect(s.landmarks[20]![LM.L_WRIST].x).toBeGreaterThan(0); // other joints unaffected
  });

  it('drops a whole frame when the entire skeleton jumps (e.g. the model locks onto another person)', () => {
    const { track } = oneJump();
    const bad = cloneTrack(track);
    bad.frames[20] = bad.frames[20]!.map((p) => ({ ...p, x: p.x + 160 }));
    const s = stabilizePose(bad);
    expect(s.stats.jumpFrames).toBe(1);
    const com = estimateCom(s.landmarks[20]!)!;
    const truth = estimateCom(track.frames[20]!)!;
    expect(Math.abs(com.x - truth.x)).toBeLessThan(6);
  });

  it('handles frames with no athlete', () => {
    const { track } = oneJump();
    const bad = cloneTrack(track);
    bad.frames[8] = null;
    for (let i = 40; i < bad.frames.length; i++) bad.frames[i] = null;
    const s = stabilizePose(bad);
    expect(s.landmarks[8]).not.toBeNull(); // one-frame dropout is bridged
    expect(s.confidence[8]).toBe(0);
    expect(s.landmarks[bad.frames.length - 1]).toBeNull();
    expect(Number.isFinite(s.bodyLengthPx)).toBe(true);
  });
});
