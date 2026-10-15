import { describe, expect, it } from 'vitest';
import { rotateAbout, standingPose } from '../analysis/testPose';
import { LM } from './landmarks';
import { FUSED_FROM, fusePoseTracks, onScale, poseGap, RTMPOSE_SCALE, shapeDoubt, type FusionInput } from './fusion';
import { HALPE26 } from './onnx/keypointMaps';
import type { Keypoint, WorldPoint } from './types';

const SECOND_JOINTS = HALPE26.filter((k) => k >= 0);
const HIPS = (p: Keypoint[]) => ({ x: (p[LM.L_HIP].x + p[LM.R_HIP].x) / 2, y: (p[LM.L_HIP].y + p[LM.R_HIP].y) / 2 });

/** An athlete turning a somersault in place, `stepDeg` a frame. */
const turning = (n: number, stepDeg: number) =>
  Array.from({ length: n }, (_, i) => standingPose(300, 400, 175, i * stepDeg));
/** RTMPose-like: the second model's scores (0.7, its median) and the BlazePose-only landmarks unseen. */
const asSecond = (p: Keypoint[], shiftPx = 0): Keypoint[] =>
  p.map((q, k) =>
    SECOND_JOINTS.includes(k) ? { x: q.x + shiftPx, y: q.y, visibility: 0.7 } : { x: 0, y: 0, visibility: 0 },
  );
/** Head where the feet are: the reading turned half a turn about the hips. */
const flipped = (p: Keypoint[]) => rotateAbout(p, HIPS(p), 180);
const world = (n: number): WorldPoint[][] =>
  Array.from({ length: n }, (_, i) => Array.from({ length: 33 }, () => ({ x: i, y: 0, z: 0, visibility: 1 })));

const input = (over: Partial<FusionInput> & Pick<FusionInput, 'first' | 'second'>): FusionInput => ({
  checked: new Uint8Array(over.first.length).fill(1),
  secondJoints: SECOND_JOINTS,
  ...over,
});

describe('putting the scores of two models on one scale', () => {
  it('reads RTMPose 0.6 as sure and 0.36 as the 0.4 the analysis drops below', () => {
    expect(onScale(0.6, RTMPOSE_SCALE)).toBe(1);
    expect(onScale(0.36, RTMPOSE_SCALE)).toBeCloseTo(0.4);
    expect(onScale(0.1, RTMPOSE_SCALE)).toBe(0);
  });
});

describe('the gap and the shape of readings', () => {
  it('measures how far two readings are, in torso lengths', () => {
    const p = standingPose(300, 400);
    const torso = 0.288 * 175;
    expect(poseGap(p, asSecond(p, 10), torso, 0.4)).toBeCloseTo(10 / torso);
    expect(poseGap(p, flipped(p), torso, 0.4)).toBeGreaterThan(1);
  });

  it('finds nothing wrong with the athlete’s own proportions, whatever their size, and a lot with a limb on somebody else', () => {
    const p = standingPose(300, 400);
    const reference = [
      0.188 * 175,
      0.188 * 175,
      0.17 * 175,
      0.17 * 175,
      0.245 * 175,
      0.245 * 175,
      0.246 * 175,
      0.246 * 175,
    ];
    const ref = [...reference, 0.296 * 175, 0.296 * 175];
    expect(shapeDoubt(p, ref, 0.4)).toBeLessThan(0.05);
    expect(shapeDoubt(standingPose(300, 400, 350), ref, 0.4)).toBeLessThan(0.05);
    const odd = p.map((q) => ({ ...q }));
    odd[LM.L_WRIST] = { x: 600, y: 100, visibility: 1 };
    odd[LM.L_ANKLE] = { x: 0, y: 700, visibility: 1 };
    expect(shapeDoubt(odd, ref, 0.4)).toBeGreaterThan(0.1);
  });
});

describe('merging two pose models', () => {
  it('averages two readings that agree and keeps the first model’s 3D landmarks', () => {
    const first = turning(10, 5);
    const w = world(10);
    const out = fusePoseTracks(input({ first, firstWorld: w, second: first.map((p) => asSecond(p, 6)) }));
    expect(out.counts.both).toBe(10);
    expect(Array.from(out.from).every((f) => f === FUSED_FROM.both)).toBe(true);
    // Both are sure on the common scale (RTMPose's 0.7 counts as 1): the mean sits halfway.
    expect(out.frames[4]![LM.L_KNEE].x).toBeCloseTo(first[4][LM.L_KNEE].x + 6 * (1 / 2), 5);
    expect(out.world[4]).toBe(w[4]);
    // A landmark only the first model gives comes from it.
    expect(out.frames[4]![LM.L_PINKY]).toEqual(first[4][LM.L_PINKY]);
  });

  it('leaves the frames that were not checked as the first model read them', () => {
    const first = turning(6, 5);
    const checked = Uint8Array.from([0, 0, 1, 1, 0, 0]);
    const out = fusePoseTracks(input({ first, second: first.map((p) => asSecond(p, 30)), checked }));
    expect(out.frames[0]).toBe(first[0]);
    expect(out.frames[5]).toBe(first[5]);
    expect(out.counts.checked).toBe(2);
  });

  it('takes the second reading where the first one put the head where the feet are, and drops its 3D landmarks there', () => {
    const truth = turning(20, 12);
    const first = truth.map((p, i) => (i >= 8 && i <= 11 ? flipped(p) : p));
    const out = fusePoseTracks(input({ first, firstWorld: world(20), second: truth.map((p) => asSecond(p)) }));
    for (let i = 8; i <= 11; i++) {
      expect(out.from[i]).toBe(FUSED_FROM.second);
      expect(out.world[i]).toBeNull();
      expect(out.frames[i]![LM.NOSE].y).toBeCloseTo(truth[i][LM.NOSE].y, 5);
    }
    expect(out.counts.replaced).toBe(4);
    expect(out.from[3]).toBe(FUSED_FROM.both);
  });

  it('keeps the first reading where the second one is the flipped one', () => {
    const truth = turning(20, 12);
    const second = truth.map((p, i) => asSecond(i >= 8 && i <= 10 ? flipped(p) : p));
    const out = fusePoseTracks(input({ first: truth, second }));
    for (let i = 8; i <= 10; i++) expect(out.from[i]).toBe(FUSED_FROM.first);
  });

  it('leaves out a frame whose only reading is turned over, for the analysis to bridge', () => {
    const truth = turning(20, 12);
    const first = truth.map((p, i) => (i === 10 ? flipped(p) : p));
    const second = truth.map((p, i) => (i === 10 ? null : asSecond(p)));
    const out = fusePoseTracks(input({ first, second }));
    expect(out.frames[10]).toBeNull();
    expect(out.counts.dropped).toBe(1);
  });

  it('fills a frame the first model missed with the second reading, the landmarks it does not give unseen', () => {
    const truth = turning(12, 8);
    const first = truth.map((p, i) => (i === 6 ? null : p));
    const out = fusePoseTracks(input({ first, second: truth.map((p) => asSecond(p)) }));
    expect(out.from[6]).toBe(FUSED_FROM.second);
    expect(out.frames[6]![LM.L_PINKY].visibility).toBe(0);
    expect(out.frames[6]![LM.L_HEEL].visibility).toBe(1);
    expect(out.counts.second).toBe(1);
    expect(out.counts.replaced).toBe(0);
  });
});
