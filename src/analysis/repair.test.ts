import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { mannequinRoutine } from '../skills/testMannequin';
import { computeAnalysis, repairTrack } from './computeAnalysis';
import { JOINT_STATE } from './stabilize';
import { rotateAbout } from './testPose';
import type { PoseTrack } from './types';

/**
 * The second reading of a track (see `computeAnalysis`): the frames the orientation tracker overruled are put right in the track
 * itself, so that the landmarks are the athlete's and not only the orientation.
 */

const HEIGHT_PX = 175;
const somersault = () => mannequinRoutine({ jumps: [{ v0: 6.5, turns: 1, facing: 1, shape: 'straight' }] });
const hipsOf = (f: Keypoint[]) => ({
  x: (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2,
  y: (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2,
});
const change = (track: PoseTrack, from: number, to: number, how: (f: Keypoint[]) => Keypoint[]): PoseTrack => ({
  ...track,
  frames: track.frames.map((f, i) => (f && i >= from && i < to ? how(f) : f)),
});
/** The model read the whole athlete upside down. */
const turnedOver = (f: Keypoint[]) => rotateAbout(f, hipsOf(f), 180);
/** Only the hips and the shoulders traded places. */
const trunkSwapped = (f: Keypoint[]) => {
  const out = f.map((p) => ({ ...p }));
  out[LM.L_SHOULDER] = { ...f[LM.L_HIP] };
  out[LM.L_HIP] = { ...f[LM.L_SHOULDER] };
  out[LM.R_SHOULDER] = { ...f[LM.R_HIP] };
  out[LM.R_HIP] = { ...f[LM.R_SHOULDER] };
  return out;
};
const off = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / HEIGHT_PX;

describe('the frames the tracker overruled, put right in the track', () => {
  it('turns back the frames the model read upside down: the head is where the head is', () => {
    const { track, truth } = somersault();
    const mid = Math.round(truth.apex[0] * 30);
    const bad = change(track, mid - 3, mid + 4, turnedOver);
    const repaired = computeAnalysis(bad);
    const orientationOnly = computeAnalysis(bad, { repairFrames: false });
    for (let i = mid - 3; i < mid + 4; i++) {
      expect(repaired.orientationFlipped[i]).toBe(1);
      for (const k of [LM.NOSE, LM.L_ANKLE, LM.R_WRIST])
        expect(off(repaired.landmarks[i]![k], track.frames[i]![k])).toBeLessThan(0.04);
      // They are the model's own points, turned: measured, not made up.
      expect(repaired.jointState[LM.NOSE][i]).toBe(JOINT_STATE.measured);
    }
    // Before, the orientation was put back and the skeleton left as the model gave it: the head at the feet.
    expect(off(orientationOnly.landmarks[mid]![LM.NOSE], track.frames[mid]![LM.NOSE])).toBeGreaterThan(0.5);
    expect(repaired.meta.orientationFlippedFrames).toBe(7);
    expect(repaired.meta.orientationFlipRuns).toBe(1);
    // The center of mass is back on the athlete's path too.
    const clean = computeAnalysis(track);
    expect(Math.abs(repaired.comY[mid] - clean.comY[mid])).toBeLessThan(0.02 * HEIGHT_PX);
    expect(Math.abs(orientationOnly.comY[mid] - clean.comY[mid])).toBeGreaterThan(0.03 * HEIGHT_PX);
  });

  it('trades the hips and the shoulders back when only they were swapped, and leaves the limbs alone', () => {
    const { track, truth } = somersault();
    const mid = Math.round(truth.apex[0] * 30);
    const repaired = computeAnalysis(change(track, mid - 3, mid + 4, trunkSwapped));
    for (let i = mid - 2; i < mid + 3; i++) {
      expect(repaired.orientationFlipped[i]).toBe(1);
      for (const k of [LM.L_SHOULDER, LM.R_HIP, LM.NOSE, LM.L_ANKLE])
        expect(off(repaired.landmarks[i]![k], track.frames[i]![k])).toBeLessThan(0.04);
    }
  });

  it('judges a frame whose trunk the tracker could not use against the orientation of the frames around it', () => {
    const { track, truth } = somersault();
    const mid = Math.round(truth.apex[0] * 30);
    // Two frames turned over stand out from their neighbors: the stabilizer throws them out as a glitch, so the tracker never sees
    // their trunk. Their orientation comes from the frames around them, and against it the frames themselves are turned over.
    const bad = change(track, mid, mid + 2, turnedOver);
    const orientationOnly = computeAnalysis(bad, { repairFrames: false });
    expect(orientationOnly.orientationFlipped[mid]).toBe(0);
    expect(orientationOnly.jointState[LM.L_ANKLE][mid]).toBe(JOINT_STATE.corrected);
    const repaired = computeAnalysis(bad);
    for (const i of [mid, mid + 1]) {
      expect(repaired.orientationFlipped[i]).toBe(1);
      // Turned back, the model's own reading of the frame is used again.
      expect(repaired.jointState[LM.L_ANKLE][i]).toBe(JOINT_STATE.measured);
      expect(off(repaired.landmarks[i]![LM.L_ANKLE], track.frames[i]![LM.L_ANKLE])).toBeLessThan(0.04);
    }
  });

  it('drops a frame read at an angle that has nothing to do with the body', () => {
    const { track, truth } = somersault();
    const mid = Math.round(truth.apex[0] * 30);
    const bad = change(track, mid, mid + 3, (f) => rotateAbout(f, hipsOf(f), 85));
    const repaired = computeAnalysis(bad);
    for (let i = mid; i < mid + 3; i++) {
      expect(repaired.orientationRejected[i]).toBe(1);
      // Bridged from the frames around it, so the athlete is still there.
      expect(repaired.jointState[LM.NOSE][i]).toBe(JOINT_STATE.interpolated);
      expect(off(repaired.landmarks[i]![LM.NOSE], track.frames[i]![LM.NOSE])).toBeLessThan(0.06);
    }
    expect(repaired.meta.orientationRejectedFrames).toBe(3);
    // What the model said of those frames is kept: it did find somebody.
    expect(repaired.confidence[mid]).toBeGreaterThan(0.9);
    expect(repaired.jumps.cycles[0].quarterTurns).toBe(4);
  });

  it('reads a track once when there is nothing to put right, and never touches a frame on the bed', () => {
    const { track, truth } = somersault();
    const clean = computeAnalysis(track);
    expect(repairTrack(track, clean, clean.orientationRejected)).toBeNull();
    expect(clean.meta.orientationFlippedFrames + clean.meta.orientationRejectedFrames).toBe(0);
    // Bent double on the bed is not a head/feet flip.
    const landed = Math.round(truth.landing[0] * 30) + 6;
    const bad = change(track, landed, landed + 3, turnedOver);
    const result = computeAnalysis(bad);
    expect(result.orientationFlipped[landed]).toBe(0);
  });
});
