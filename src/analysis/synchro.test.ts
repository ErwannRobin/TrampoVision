import { describe, expect, it } from 'vitest';
import type { JumpCycle } from './jumpCycles';
import { synchroScore, type SynchroJumpInput } from './synchro';

/** A complete jump taking off at `t`, flying 1.2 s and gaining `rise` meters. */
function jump(index: number, t: number, rise = 3, skill: SynchroJumpInput['skill'] = 'tuck-jump'): SynchroJumpInput {
  const cycle = {
    index,
    complete: true,
    takeoffTimeS: t,
    apexTimeS: t + 0.6,
    landingTimeS: t + 1.2,
    riseM: rise,
    apexHeightM: rise + 1,
  } as JumpCycle;
  return { cycle, skill };
}

describe('synchroScore', () => {
  it('gives the full mark to identical jumps', () => {
    const s = synchroScore([
      [jump(0, 1), jump(1, 3)],
      [jump(0, 1), jump(1, 3)],
    ]);
    expect(s.score).toBe(10);
    expect(s.jumps).toHaveLength(2);
    expect(s.unmatched).toBe(0);
  });

  it('loses a point for 0.1 s apart', () => {
    const s = synchroScore([[jump(0, 1)], [jump(0, 1.1)]]);
    expect(s.score).toBe(9);
    expect(s.meanTimingS).toBeCloseTo(0.1);
  });

  it('loses points for a different height and for a different skill', () => {
    const height = synchroScore([[jump(0, 1, 3)], [jump(0, 1, 2.85)]]);
    expect(height.score).toBe(9.5);
    const skill = synchroScore([[jump(0, 1)], [jump(0, 1, 3, 'pike-jump')]]);
    expect(skill.score).toBe(7);
    expect(skill.jumps[0].sameSkill).toBe(false);
  });

  it('cannot judge the skill when one athlete is not classified, and does not punish it', () => {
    const s = synchroScore([[jump(0, 1)], [jump(0, 1, 3, 'unclassified')]]);
    expect(s.jumps[0].sameSkill).toBeNull();
    expect(s.score).toBe(10);
  });

  it('matches jumps by time, so a jump one athlete missed does not shift the others', () => {
    const s = synchroScore([
      [jump(0, 1), jump(1, 3), jump(2, 5)],
      [jump(0, 3.05), jump(1, 5.05)],
    ]);
    expect(s.jumps.map((j) => j.number)).toEqual([2, 3]);
    expect(s.unmatched).toBe(1);
  });

  it('never goes under zero and has no score without a shared jump', () => {
    expect(synchroScore([[jump(0, 1, 3)], [jump(0, 1.7, 1, 'pike-jump')]]).score).toBeGreaterThanOrEqual(0);
    expect(synchroScore([[jump(0, 1)], [jump(0, 9)]]).score).toBeNull();
    expect(synchroScore([[jump(0, 1)]]).score).toBeNull();
  });

  it('works with three athletes: the spread is between the first and the last', () => {
    const s = synchroScore([[jump(0, 1)], [jump(0, 1.05)], [jump(0, 1.1)]]);
    expect(s.score).toBe(9);
  });
});
