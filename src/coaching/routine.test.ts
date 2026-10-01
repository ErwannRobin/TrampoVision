import { describe, expect, it } from 'vitest';
import { detectRoutineStart, ROUTINE_LEAD_S, routineStartJump, routineStartTime } from './routine';

const bounce = { isSkill: false, pending: false, coachDeduction: null };
const skill = { isSkill: true, pending: false, coachDeduction: null };
const guess = { isSkill: true, pending: true, coachDeduction: null };

describe('detectRoutineStart', () => {
  it('starts at the first jump that is not a straight jump', () => {
    expect(detectRoutineStart([bounce, bounce, skill, skill])).toBe(2);
    expect(detectRoutineStart([skill, bounce])).toBe(0);
  });

  it('starts at a jump a person gave an execution point to, even when it was taken for a bounce', () => {
    expect(detectRoutineStart([bounce, { ...bounce, coachDeduction: 0.1 }, skill])).toBe(1);
    expect(detectRoutineStart([bounce, { ...bounce, coachDeduction: 0 }])).toBe(1);
  });

  it('does not let an unsure guess start the routine early when a surer skill follows', () => {
    expect(detectRoutineStart([bounce, guess, bounce, skill])).toBe(3);
  });

  it('falls back on the guess when nothing is surer', () => {
    expect(detectRoutineStart([bounce, bounce, guess])).toBe(2);
  });

  it('is null for a clip of bounces, or without jumps', () => {
    expect(detectRoutineStart([bounce, bounce])).toBeNull();
    expect(detectRoutineStart([])).toBeNull();
  });
});

describe('routineStartTime', () => {
  it('is a little before the takeoff, and never before the clip', () => {
    expect(routineStartTime({ takeoffTimeS: 5, apexTimeS: 5.6 })).toBeCloseTo(5 - ROUTINE_LEAD_S, 9);
    expect(routineStartTime({ takeoffTimeS: 0.1, apexTimeS: 0.7 })).toBe(0);
    expect(routineStartTime({ takeoffTimeS: 2, apexTimeS: 2.5 }, 1.9)).toBe(1.9);
  });
  it('uses the apex of a jump that was cut off at the start of the clip', () => {
    expect(routineStartTime({ takeoffTimeS: null, apexTimeS: 3 })).toBeCloseTo(3 - ROUTINE_LEAD_S, 9);
  });
});

describe('routineStartJump', () => {
  it('follows the detection until a person says otherwise', () => {
    expect(routineStartJump(undefined, 2, 6)).toBe(2);
    expect(routineStartJump(4, 2, 6)).toBe(4);
  });
  it('is none when a person took the mark off', () => {
    expect(routineStartJump(null, 2, 6)).toBeNull();
  });
  it('ignores a jump that is not in the clip (a new analysis with fewer jumps)', () => {
    expect(routineStartJump(9, 2, 6)).toBeNull();
    expect(routineStartJump(undefined, null, 6)).toBeNull();
    expect(routineStartJump(-1, null, 6)).toBeNull();
  });
});
