import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import type { SkillPrediction } from '../skills/types';
import { callOf } from './guess';

const predict = (jump: Parameters<typeof mannequinRoutine>[0]['jumps'][number], config = {}) => {
  const { track } = mannequinRoutine({ jumps: [jump], facing: 1 });
  return analyzeSkills(computeAnalysis(track, { athleteHeightM: 1.75 }), { config }).jumps[0].prediction;
};

describe('the call for a jump', () => {
  it('is the classifier’s element, with its difficulty and the other candidates', () => {
    const c = callOf(predict({ v0: 4.8, turns: -1, shape: 'tuck' }))!;
    expect(c.element.id).toBe('back-1s-0t-tuck');
    expect(c.element.difficulty).toBe(0.5);
    expect(c.certainty).toBe('confident');
    expect(c.forced).toBe(false);
    expect(c.alternatives.length).toBeGreaterThan(0);
    expect(c.alternatives.map((a) => a.elementId)).not.toContain('back-1s-0t-tuck');
    expect(c.alternatives.every((a) => a.score >= 0 && a.score <= 1)).toBe(true);
  });

  it('is the closest element, flagged, for a jump the classifier would not name', () => {
    const p = predict({ v0: 4.6, turns: 1.25, shape: 'straight' });
    const c = callOf(p)!;
    expect(c.forced).toBe(true);
    expect(c.certainty).toBe('tentative');
    expect(c.element.id).toBe(p.elementId);
  });

  it('still finds the closest element in a prediction saved before the classifier guessed', () => {
    const declined = predict({ v0: 4.6, turns: 1.25, shape: 'straight' }, { forceGuess: false });
    expect(declined.skill).toBe('unclassified');
    const c = callOf(declined)!;
    expect(c.forced).toBe(true);
    expect(c.element.id).toBe(declined.candidates![0].elementId);
  });

  it('gives the likelier direction for a somersault of unknown direction, and offers the other one first', () => {
    const declined = predict({ v0: 4.8, turns: 1, shape: 'tuck' }, { facing: { override: 'auto' }, forceGuess: false });
    // The mannequin's facing is measurable, so build the old kind of prediction from it.
    const unknown: SkillPrediction = {
      ...declined,
      skill: 'somersault-direction-unknown',
      elementId: undefined,
      movement: { direction: null, somersaults: 1, twists: 0, position: 'tuck' },
    };
    const c = callOf(unknown)!;
    expect(c.element.direction).toBe('back');
    expect(c.directionAssumed).toBe(true);
    expect(c.alternatives[0].elementId).toBe('front-1s-0t-tuck');
  });

  it('has nothing for a jump with no candidate', () => {
    const empty = { skill: 'unclassified', confidence: 0, candidates: undefined } as unknown as SkillPrediction;
    expect(callOf(empty)).toBeNull();
  });
});
