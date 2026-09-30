import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import { OTHER_LABEL, withCalls } from './display';
import { buildSession } from './session';

const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'tuck' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.8, turns: 1, shape: 'pike' },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);

describe('the skills as they are shown', () => {
  it('keeps the classifier’s names when nobody said anything, and never changes the raw analysis', () => {
    const session = buildSession({ skills, result, twist: null });
    const shown = withCalls(skills, session);
    expect(shown.jumps.map((j) => j.prediction.label)).toEqual(skills.jumps.map((j) => j.prediction.label));
    expect(shown.frames).toBe(skills.frames);
  });

  it('shows the coach’s label with full confidence, and the rest untouched', () => {
    const session = buildSession({
      skills,
      result,
      twist: null,
      labels: [null, { elementId: 'back-1s-0t-pike', other: false, deduction: null }, null],
    });
    const shown = withCalls(skills, session);
    expect(shown.jumps[1].prediction).toMatchObject({
      label: 'Back somersault (pike)',
      elementId: 'back-1s-0t-pike',
      confidence: 1,
      certainty: 'confident',
    });
    expect(shown.jumps[1].prediction.movement).toEqual({
      direction: 'back',
      somersaults: 1,
      twists: 0,
      position: 'pike',
    });
    expect(shown.jumps[2].prediction.label).toBe(skills.jumps[2].prediction.label);
    expect(shown.jumps[2].prediction.confidence).toBe(skills.jumps[2].prediction.confidence);
    expect(skills.jumps[1].prediction.label).not.toBe('Back somersault (pike)');
  });

  it('shows a jump the coach says is something else as such', () => {
    const session = buildSession({
      skills,
      result,
      twist: null,
      labels: [null, { elementId: null, other: true, deduction: null }, null],
    });
    expect(withCalls(skills, session).jumps[1].prediction).toMatchObject({ label: OTHER_LABEL, skill: 'unclassified' });
  });
});
