import { describe, expect, it } from 'vitest';
import { computeAnalysis } from './computeAnalysis';
import { rotateAbout, standingPose } from './testPose';
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
