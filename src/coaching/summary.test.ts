import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import { buildSession } from './session';
import { deductionText, difficultyText, summaryText } from './summary';

describe('the figures as they are written', () => {
  it('writes a difficulty with one decimal and a deduction like a score sheet', () => {
    expect(difficultyText(1.25)).toBe('1.3');
    expect(difficultyText(0)).toBe('0.0');
    expect(deductionText(0)).toBe('0.0');
    expect(deductionText(0.2)).toBe('−0.2');
    expect(deductionText(null)).toBe('–');
  });
});

describe('the set as text', () => {
  const { track } = mannequinRoutine({
    jumps: [
      { v0: 4.4, shape: 'straight' },
      { v0: 4.8, turns: -1, shape: 'tuck' },
      { v0: 4.8, turns: 1, shape: 'pike' },
    ],
    facing: 1,
  });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const session = buildSession({ skills: analyzeSkills(result), result, twist: null });
  const text = summaryText(session, 'Session');

  it('says how many skills, the totals and one line per skill, without the bounce', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('Session: 2 skills');
    expect(lines[1]).toMatch(/^Difficulty 1\.1, execution about \d+\.\d out of 10, \d\.\d s in the air$/);
    expect(text).toMatch(/2\. Back somersault \(tuck\): difficulty 0\.5/);
    expect(text).toMatch(/3\. Front somersault \(pike\): difficulty 0\.6/);
    expect(text).not.toMatch(/1\. Straight jump/);
  });

  it('gives a plain minus sign, so it survives a message', () => {
    expect(text).not.toContain('−');
  });
});
