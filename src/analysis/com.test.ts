import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT } from '../pose/landmarks';
import { SEGMENTS, estimateCom } from './com';
import { angleFromVertical, jointAngle } from './geometry';
import { standingPose } from './testPose';

describe('segment model', () => {
  it('mass fractions sum to 1 (limbs counted on both sides)', () => {
    expect(SEGMENTS.reduce((s, seg) => s + seg.mass, 0)).toBeCloseTo(1, 4);
  });
});

describe('estimateCom', () => {
  it('lies on the body axis, between hips and shoulders, for a symmetric standing pose', () => {
    const pts = standingPose(100, 300);
    const com = estimateCom(pts)!;
    expect(com.coverage).toBeCloseTo(1, 6);
    // only the forward-pointing toes pull the COM slightly off the axis
    expect(Math.abs(com.x - 100)).toBeLessThan(1);
    // pelvis is at y = 300 - 0.53H; COM should be near it (a bit higher), well inside the torso
    const hipY = pts[23].y;
    const shoulderY = pts[11].y;
    expect(com.y).toBeLessThan(hipY);
    expect(com.y).toBeGreaterThan(shoulderY);
  });

  it('renormalizes when a limb is missing and reports reduced coverage', () => {
    const pts = standingPose(0, 0);
    pts[15] = { x: NaN, y: NaN, visibility: 0 }; // left wrist
    const com = estimateCom(pts)!;
    expect(com.coverage).toBeLessThan(1);
    expect(com.coverage).toBeGreaterThan(0.95);
  });

  it('returns null with no data', () => {
    expect(estimateCom(Array.from({ length: LANDMARK_COUNT }, () => ({ x: NaN, y: NaN, visibility: 0 })))).toBeNull();
  });
});

describe('geometry', () => {
  it('joint angle: straight = 180, right angle = 90', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
    expect(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90);
  });
  it('angle from vertical uses image coordinates (y down)', () => {
    const o = { x: 0, y: 0 };
    expect(angleFromVertical(o, { x: 0, y: -1 })).toBeCloseTo(0); // up
    expect(angleFromVertical(o, { x: 1, y: 0 })).toBeCloseTo(90); // right = clockwise
    expect(angleFromVertical(o, { x: 0, y: 1 })).toBeCloseTo(180); // down = inverted
    expect(angleFromVertical(o, { x: -1, y: 0 })).toBeCloseTo(-90);
  });
});
