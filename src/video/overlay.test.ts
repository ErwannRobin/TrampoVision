import { describe, expect, it } from 'vitest';
import type { SkillPrediction } from '../skills/types';
import { skillChip } from './overlay';

const prediction = (skill: string, confidence: number, label = 'Tuck jump'): SkillPrediction =>
  ({ skill, label, confidence }) as unknown as SkillPrediction;

describe('the skill chip on the video', () => {
  it('names the skill and says nothing about the confidence in words or numbers', () => {
    const chip = skillChip(prediction('tuck-jump', 0.92), 0.3);
    expect(chip.parts).toEqual([{ text: 'Tuck jump' }]);
  });

  it('carries the confidence in its dot: high, medium, low, or not classified', () => {
    expect(skillChip(prediction('tuck-jump', 0.9), 0.3).mark).toBe('high');
    expect(skillChip(prediction('tuck-jump', 0.45), 0.3).mark).toBe('medium');
    expect(skillChip(prediction('unclassified', 0.2), 0.3).mark).toBe('low');
    const none = skillChip(prediction('unclassified', 0), 0.3);
    expect(none.mark).toBe('none');
    expect(none.parts).toEqual([{ text: 'Not classified' }]);
  });
});
