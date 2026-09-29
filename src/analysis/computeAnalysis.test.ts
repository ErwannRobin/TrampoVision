import { describe, expect, it } from 'vitest';
import { computeAnalysis } from './computeAnalysis';
import { LM } from '../pose/landmarks';
import type { TrampolineCalibration } from './calibration';
import { JUMP_PHASES } from './jumpCycles';
import { rotateAbout, standingPose } from './testPose';
import { addNoise, syntheticRoutine } from './testTracks';
import type { PoseTrack } from './types';

const G = 9.81;

/**
 * Synthetic jump: the pelvis follows a ballistic arc (launch speed v0) while the body performs
 * one full clockwise rotation about the hips. Ground truth is analytic.
 */
function syntheticJump(fps = 30, pxPerM = 100, noisePx = 0): { track: PoseTrack; v0: number; flight: number } {
  const v0 = 5; // m/s -> flight time 1.02 s, apex 1.27 m
  const flight = (2 * v0) / G;
  const n = Math.round(flight * fps) + 1;
  const H = 1.75 * pxPerM;
  const floorY = 600;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const frames = [];
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const lift = (v0 * t - 0.5 * G * t * t) * pxPerM;
    const angle = (360 * t) / flight;
    const base = standingPose(320, floorY - lift, H);
    const rotated = rotateAbout(base, { x: 320, y: floorY - lift - 0.53 * H }, angle);
    frames.push(rotated.map((p) => ({ ...p, x: p.x + noisePx * rnd(), y: p.y + noisePx * rnd() })));
    times.push(t);
  }
  return {
    track: { width: 640, height: 720, fps, sourceFps: fps, times, frames, backend: 'synthetic' },
    v0,
    flight,
  };
}

describe('computeAnalysis on a synthetic somersault', () => {
  it('recovers apex height, vertical velocity and rotation', () => {
    const { track, v0, flight } = syntheticJump();
    const r = computeAnalysis(track, { athleteHeightM: 1.75 });

    // Scale estimate: skeleton length ~ 0.9 H by construction, so pxPerM should be close to 100.
    expect(r.meta.pixelsPerMeter).toBeGreaterThan(90);
    expect(r.meta.pixelsPerMeter).toBeLessThan(110);

    // COM moves with the pelvis up to a constant offset (rotation moves the COM slightly relative
    // to the pelvis), so compare the height *change* to the analytic apex.
    const apex = (v0 * v0) / (2 * G);
    expect(r.summary.maxHeightM).toBeGreaterThan(apex * 0.85);
    expect(r.summary.maxHeightM).toBeLessThan(apex * 1.25);

    // Velocity at take-off / landing is +/- v0, zero near the apex (loose bounds: the COM
    // wanders relative to the pelvis while the body rotates).
    const mid = Math.round((flight / 2) * 30);
    expect(Math.abs(r.vy[mid])).toBeLessThan(1);
    expect(r.vy[3]).toBeGreaterThan(v0 * 0.5);
    expect(r.vy[r.vy.length - 4]).toBeLessThan(-v0 * 0.5);

    // Exactly one clockwise turn.
    expect(r.summary.totalRotationDeg).toBeGreaterThan(330);
    expect(r.summary.totalRotationDeg).toBeLessThan(390);
    // Angular velocity ~ 360 / flight deg/s
    expect(r.angularVelocity[mid]).toBeGreaterThan((360 / flight) * 0.8);
    expect(r.angularVelocity[mid]).toBeLessThan((360 / flight) * 1.2);
  });

  it('is robust to landmark noise', () => {
    const { track, flight } = syntheticJump(60, 100, 1.5);
    const r = computeAnalysis(track);
    expect(r.summary.totalRotationDeg).toBeGreaterThan(320);
    expect(r.summary.totalRotationDeg).toBeLessThan(400);
    const mid = Math.round((flight / 2) * 60);
    expect(Math.abs(r.vy[mid])).toBeLessThan(1.2);
  });

  it('reports knee/hip angles of ~180 for a straight body', () => {
    const { track } = syntheticJump();
    const r = computeAnalysis(track);
    expect(r.joints.leftKnee[5]).toBeGreaterThan(170);
    // the frontal-view fixture offsets shoulders/hips sideways, so the hip angle is ~164, not 180
    expect(r.joints.rightHip[5]).toBeGreaterThan(160);
  });

  it('leaves NaN where no athlete was detected and interpolates short dropouts', () => {
    const { track } = syntheticJump();
    track.frames[10] = null; // one-frame dropout -> interpolated
    for (let i = 20; i < track.frames.length; i++) track.frames[i] = null; // long dropout -> NaN
    const r = computeAnalysis(track);
    expect(Number.isFinite(r.comY[10])).toBe(true);
    expect(Number.isNaN(r.comY[track.frames.length - 1])).toBe(true);
    expect(r.confidence[10]).toBe(0);
    expect(r.summary.validFraction).toBeLessThan(1);
  });
});

describe('full pipeline on a synthetic routine', () => {
  const routine = { jumps: [{ v0: 4.2 }, { v0: 5.2, turns: 2, driftM: 0.6 }, { v0: 4.6, turns: -1 }] };

  it('finds the jumps, their timing and the somersault counts through noise, glitches and a dropout', () => {
    const { track, truth } = syntheticRoutine(routine);
    const bad = addNoise(track, 1.5);
    bad.frames[25] = bad.frames[25]!.map((p, k) => (k === LM.L_WRIST ? { ...p, x: p.x + 130, y: p.y - 80 } : p));
    for (let i = 60; i < 64; i++) bad.frames[i] = null; // ~0.13 s without a detection
    const r = computeAnalysis(bad);
    expect(r.jumps.cycles).toHaveLength(3);
    r.jumps.cycles.forEach((c, k) => {
      expect(Math.abs(c.flightTimeS! / truth.flight[k] - 1)).toBeLessThan(0.08);
      expect(Math.abs(c.takeoffTimeS! - truth.takeoff[k])).toBeLessThan(0.07);
    });
    expect(r.jumps.cycles.map((c) => c.quarterTurns)).toEqual([0, 8, -4]);
    expect(r.jumps.cycles.map((c) => c.completedRotations)).toEqual([0, 2, -1]);
    expect(r.summary.completedRotations).toBe(3);
    expect(r.summary.jumpCount).toBe(3);
    expect(r.meta.maxRotationStepDeg).toBeLessThan(60);
  });

  it('keeps the body orientation continuous through a double somersault (never wraps back)', () => {
    const { track, truth } = syntheticRoutine({ jumps: [{ v0: 5, turns: 2 }] });
    const r = computeAnalysis(track);
    for (let i = 1; i < r.orientation.length; i++)
      expect(Math.abs(r.orientation[i] - r.orientation[i - 1])).toBeLessThan(45);
    const i0 = Math.round(truth.takeoff[0] * 30) - 3;
    const i1 = Math.round(truth.landing[0] * 30) + 3;
    expect(r.orientation[i1] - r.orientation[i0]).toBeGreaterThan(680);
    expect(r.orientation[i1] - r.orientation[i0]).toBeLessThan(760);
    // The wrapped angle does wrap; the orientation does not.
    expect(Math.min(...Array.from(r.trunkAngle).filter(Number.isFinite))).toBeLessThan(-150);
  });

  it('labels the phases frame by frame', () => {
    const { track, truth } = syntheticRoutine({ jumps: [{ v0: 5 }] });
    const r = computeAnalysis(track);
    const phaseAt = (t: number) => JUMP_PHASES[r.jumps.phase[Math.round(t * 30)]];
    expect(phaseAt(0.1)).toBe('ground');
    expect(phaseAt(truth.takeoff[0] + 0.2)).toBe('ascent');
    expect(phaseAt(truth.apex[0])).toBe('apex');
    expect(phaseAt(truth.apex[0] + 0.2)).toBe('descent');
    expect(phaseAt(truth.landing[0] + 0.3)).toBe('ground');
  });

  describe('with a trampoline calibration', () => {
    // Bed drawn as a rectangle 428 px wide (100 px/m along x) centered at the athlete's start x.
    const corners: TrampolineCalibration['corners'] = [
      { x: 106, y: 640 },
      { x: 534, y: 640 },
      { x: 534, y: 560 },
      { x: 106, y: 560 },
    ];
    const calibration: TrampolineCalibration = { corners, firstSideM: 4.28, secondSideM: 2.14 };

    it('normalizes position to the bed: height above the bed and horizontal offset from its center', () => {
      const { track, truth } = syntheticRoutine({ jumps: [{ v0: 5, driftM: 1.0 }] });
      const r = computeAnalysis(track, { calibration });
      expect(r.meta.calibrated).toBe(true);
      expect(r.meta.scaleSource).toBe('trampoline');
      expect(r.meta.heightReference).toBe('bed');
      expect(r.meta.pixelsPerMeter).toBeCloseTo(100, 0);
      expect(r.meta.trampolinePixelsPerMeter / r.meta.athletePixelsPerMeter).toBeGreaterThan(0.9);
      expect(r.meta.trampolinePixelsPerMeter / r.meta.athletePixelsPerMeter).toBeLessThan(1.1);
      // Standing on the bed: the center of mass is about a meter above it, and over the bed center.
      expect(r.height[2]).toBeGreaterThan(0.85);
      expect(r.height[2]).toBeLessThan(1.1);
      expect(Math.abs(r.x[2])).toBeLessThan(0.05);
      expect(Math.abs(r.xNorm[2])).toBeLessThan(0.03);
      const c = r.jumps.cycles[0];
      expect(Math.abs(c.horizontalDisplacementM! - 1.0)).toBeLessThan(0.1);
      // After landing the athlete stands 1 m to the right of the bed center: half the bed's half-length.
      const last = r.x.length - 1;
      expect(r.x[last]).toBeGreaterThan(0.9);
      expect(r.xNorm[last]).toBeCloseTo(1.0 / 2.14, 1);
      void truth;
    });

    it('stays uncalibrated without corners, and reports bad corners instead of failing', () => {
      const { track } = syntheticRoutine({ jumps: [{ v0: 5 }] });
      const plain = computeAnalysis(track);
      expect(plain.meta.calibrated).toBe(false);
      expect(plain.meta.heightReference).toBe('lowest point');
      expect(Number.isNaN(plain.xNorm[5])).toBe(true);
      const bowTie = {
        ...calibration,
        corners: [corners[0], corners[2], corners[1], corners[3]] as TrampolineCalibration['corners'],
      };
      const r = computeAnalysis(track, { calibration: bowTie });
      expect(r.meta.calibrated).toBe(false);
      expect(r.meta.calibrationError).toMatch(/order/);
      expect(r.meta.scaleSource).toBe('athlete');
    });

    it('can use the athlete height for the scale even when calibrated', () => {
      const { track } = syntheticRoutine({ jumps: [{ v0: 5 }] });
      const r = computeAnalysis(track, { calibration, scaleSource: 'athlete' });
      expect(r.meta.scaleSource).toBe('athlete');
      expect(r.meta.heightReference).toBe('bed');
      expect(r.meta.pixelsPerMeter).toBeCloseTo(r.meta.athletePixelsPerMeter, 6);
    });
  });
});
