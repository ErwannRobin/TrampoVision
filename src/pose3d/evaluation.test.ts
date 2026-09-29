import { describe, expect, it } from 'vitest';
import { evaluateTwist } from './evaluation';

const JUMPS = 40;

describe('twist estimator on random synthetic jumps (0 to 3 twists, with and without somersault, several yaw angles)', () => {
  it('is right with perfect landmarks', () => {
    const r = evaluateTwist({ name: 'perfect' }, { jumps: JUMPS });
    expect(r.exact).toBeGreaterThanOrEqual(0.98);
    expect(r.reliableWrong).toBe(0);
  });

  it('stays right, and confident only when right, with 1-3 cm of depth noise', () => {
    for (const d of [0.01, 0.02, 0.03]) {
      const r = evaluateTwist({ name: `depth ${d}`, degrade: { depthNoiseM: d } }, { jumps: JUMPS });
      expect(r.reliableWrong, `depth noise ${d}`).toBe(0);
      expect(r.exact, `depth noise ${d}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('declines when the depth is too noisy, instead of answering wrongly', () => {
    const r = evaluateTwist({ name: 'depth 10 cm', degrade: { depthNoiseM: 0.1 } }, { jumps: JUMPS });
    expect(r.reliableShare).toBeLessThanOrEqual(0.1);
    expect(r.reliableWrong).toBe(0);
  });

  it('declines on left/right label swaps', () => {
    const r = evaluateTwist({ name: 'swap', degrade: { swapLeftRight: [22, 30] } }, { jumps: JUMPS });
    expect(r.reliableShare).toBeLessThanOrEqual(0.1);
    expect(r.reliableWrong).toBe(0);
  });

  it('declines when a constant depth bias of the trunk (15 degrees) would create a phantom twist in a somersault', () => {
    const r = evaluateTwist({ name: 'bias', degrade: { trunkLeanBias: 0.27 }, somersaultOnly: true }, { jumps: JUMPS });
    expect(r.reliableShare).toBeLessThanOrEqual(0.1);
    expect(r.reliableWrong).toBe(0);
  });

  it('never calls a wrong count reliable at a low frame rate or with missing frames', () => {
    for (const cond of [{ name: '10 fps', fps: 10 }, { name: '15 fps', fps: 15 }, { name: 'gaps', degrade: { dropout: 0.3 } }]) {
      expect(evaluateTwist(cond, { jumps: JUMPS }).reliableWrong, cond.name).toBe(0);
    }
  });
});
