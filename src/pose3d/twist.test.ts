import { describe, expect, it } from 'vitest';
import { DEFAULT_TWIST_CONFIG } from './config';
import { degradeWorld, syntheticTwistJump, type TwistJumpSpec, type WorldDegrade } from './testTwistMannequin';
import { analyzeTwist, NO_3D } from './twist';
import { cross, rotateAbout, signedAngleDeg, transport, unit } from './vec3';

function run(spec: TwistJumpSpec, degrade?: WorldDegrade) {
  const s = syntheticTwistJump(spec);
  const world = degrade ? degradeWorld(s.world, degrade) : s.world;
  const analysis = analyzeTwist({ ...s.input, world });
  return { truth: s.truthTwistDeg, est: analysis.jumps[0], analysis, input: s.input };
}

describe('vector helpers', () => {
  it('rotates by the right-hand rule and measures the same angle back', () => {
    const axis: [number, number, number] = [0, 0, 1];
    const r = rotateAbout([1, 0, 0], axis, 90);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
    expect(signedAngleDeg([1, 0, 0], r, axis)).toBeCloseTo(90);
    expect(signedAngleDeg(r, [1, 0, 0], axis)).toBeCloseTo(-90);
  });
  it('carrying a vector along a turning axis leaves only the spin about the axis', () => {
    const from = unit([0, 1, 0]);
    const to = unit([1, 1, 0]);
    const lateral: [number, number, number] = [0, 0, 1]; // perpendicular to both axes, in the turning plane's normal
    const carried = transport(lateral, from, to)!;
    expect(carried[2]).toBeCloseTo(1); // a pure swing does not change it
    // A line that is not along the swing's normal is turned with the axis: it stays perpendicular to the new axis.
    const inPlane = transport(cross(from, lateral), from, to)!;
    expect(inPlane[0] * to[0] + inPlane[1] * to[1] + inPlane[2] * to[2]).toBeCloseTo(0);
  });
});

describe('twist about the longitudinal axis (synthetic 3D athlete, perfect landmarks)', () => {
  it('reads no twist for a straight jump and for a somersault without twist', () => {
    for (const spec of [{}, { somersaultTurns: 1 }, { somersaultTurns: -1, facing: 1 as const }]) {
      const { est } = run(spec);
      expect(est.available).toBe(true);
      expect(Math.abs(est.totalDeg!)).toBeLessThan(5);
      expect(est.halfTwists).toBe(0);
      expect(est.direction).toBe('none');
      expect(est.reliable).toBe(true);
    }
  });

  it('counts half twists, with the right sign, alone and during a somersault', () => {
    for (const somersaultTurns of [0, 1, -1]) {
      for (const twistTurns of [0.5, 1, 2, -1]) {
        const { truth, est } = run({ somersaultTurns, twistTurns });
        expect(Math.abs(est.totalDeg! - truth), `som ${somersaultTurns} twist ${twistTurns}`).toBeLessThan(10);
        expect(est.halfTwists).toBe(Math.abs(twistTurns) * 2);
        expect(Math.sign(est.totalDeg!)).toBe(Math.sign(truth));
        expect(est.reliable).toBe(true);
      }
    }
  });

  it('does not depend on which way the athlete faces or on the camera yaw', () => {
    for (const facing of [1, -1] as const) {
      for (const yawDeg of [0, 30, 60, 90]) {
        const { truth, est } = run({ somersaultTurns: 1, twistTurns: 1, facing, yawDeg });
        expect(Math.abs(est.totalDeg! - truth)).toBeLessThan(10);
      }
    }
  });

  it('reports twist speed close to the true one', () => {
    // A full twist between 15% and 85% of a 1 s flight with a smoothstep profile peaks at 1.5 x 360 / 0.7 = 771 deg/s.
    const { est } = run({ twistTurns: 1 });
    expect(est.peakAngularVelocityDps!).toBeGreaterThan(771 * 0.8);
    expect(est.peakAngularVelocityDps!).toBeLessThan(771 * 1.2);
  });

  it('gives the same twist at another frame rate', () => {
    const { est } = run({ twistTurns: 1, fps: 60 });
    expect(Math.abs(est.totalDeg! - 360)).toBeLessThan(10);
  });
});

describe('what the estimator says when the 3D data is bad', () => {
  it('stays accurate and confident with 2 cm of depth noise, and declines with 10 cm', () => {
    const good = run({ somersaultTurns: 1, twistTurns: 1 }, { depthNoiseM: 0.02 });
    expect(Math.abs(good.est.totalDeg! - 360)).toBeLessThan(25);
    expect(good.est.reliable).toBe(true);
    const bad = run({ somersaultTurns: 1, twistTurns: 1 }, { depthNoiseM: 0.1 });
    expect(bad.est.reliable).toBe(false);
    expect(bad.est.limitations.some((l) => l.signal === 'Depth consistency')).toBe(true);
  });

  it('flags a constant depth error of the trunk: a somersault turns into a phantom twist (measured on real output: -94 degrees)', () => {
    const { est } = run({ somersaultTurns: 1, twistTurns: 0 }, { trunkLeanBias: 0.27 });
    // The 3D axis reports a twist that is not there; the image-plane axis does not.
    expect(Math.abs(est.totalDeg!)).toBeGreaterThan(80);
    expect(Math.abs(est.cross.inPlaneAxisDeg!)).toBeLessThan(5);
    expect(est.parts.axisDepth).toBeLessThan(0.5);
    expect(est.reliable).toBe(false);
    expect(est.limitations.some((l) => l.signal === 'Axis depth')).toBe(true);
  });

  it('does not invent a phantom twist without a somersault', () => {
    const { est } = run({ somersaultTurns: 0, twistTurns: 0 }, { trunkLeanBias: 0.27 });
    expect(Math.abs(est.totalDeg!)).toBeLessThan(5);
    expect(est.reliable).toBe(true);
  });

  it('counts left/right label swaps and lowers the confidence', () => {
    const { est } = run({ twistTurns: 1 }, { swapLeftRight: [22, 30] });
    expect(est.flips).toBeGreaterThan(0);
    expect(est.reliable).toBe(false);
    expect(est.limitations.some((l) => l.signal === 'Left/right swaps')).toBe(true);
  });

  it('declines a fast twist at a low frame rate instead of guessing', () => {
    const { est } = run({ twistTurns: 3, fps: 10 });
    expect(est.reliable).toBe(false);
    expect(est.maxStepDeg!).toBeGreaterThan(90);
  });

  it('bridges short gaps and lowers the coverage for missing frames', () => {
    const { est } = run({ somersaultTurns: 1, twistTurns: 1 }, { dropout: 0.3 });
    expect(Math.abs(est.totalDeg! - 360)).toBeLessThan(30);
    expect(est.parts.coverage).toBeLessThan(1);
    expect(est.parts.coverage).toBeGreaterThan(0.5);
  });

  it('a long gap in the middle of the flight is not bridged and shows in the coverage', () => {
    const s = syntheticTwistJump({ twistTurns: 1 });
    const world = s.world.map((f, i) => (i >= 20 && i <= 27 ? null : f));
    const a = analyzeTwist({ ...s.input, world });
    expect(a.jumps[0].parts.coverage).toBeLessThan(0.85);
    expect(a.jumps[0].limitations.some((l) => l.signal === '3D torso coverage')).toBe(true);
  });

  it('says so when there is no 3D data at all', () => {
    const s = syntheticTwistJump({ twistTurns: 1 });
    const a = analyzeTwist({ ...s.input, world: undefined });
    expect(a.frames).toBeNull();
    expect(a.jumps[0].available).toBe(false);
    expect(a.jumps[0].totalDeg).toBeNull();
    expect(a.jumps[0].limitations).toContainEqual(NO_3D);
  });

  it('says so for a jump cut off by the clip', () => {
    const s = syntheticTwistJump({ twistTurns: 1 });
    const a = analyzeTwist({
      ...s.input,
      cycles: [{ ...s.input.cycles[0], takeoff: null, takeoffTimeS: null, complete: false }],
    });
    expect(a.jumps[0].available).toBe(false);
    expect(a.jumps[0].limitations[0].signal).toBe('Twist');
  });

  it('warns that a side view reads the twist from depth ordering only', () => {
    const side = run({ twistTurns: 1, yawDeg: 0 }).est;
    expect(side.shoulderDepthShare!).toBeGreaterThan(0.5);
    expect(side.limitations.some((l) => l.signal === 'Side view')).toBe(true);
    const front = run({ twistTurns: 1, yawDeg: 90 }).est;
    expect(front.limitations.some((l) => l.signal === 'Side view')).toBe(false);
  });

  it('exposes the thresholds it used', () => {
    const { analysis } = run({});
    expect(analysis.config).toEqual(DEFAULT_TWIST_CONFIG);
  });
});
