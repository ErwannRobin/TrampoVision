import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_EXAMPLES,
  difficultyOf,
  difficultyRange,
  difficultyValue,
  exampleMovement,
  totalDifficulty,
} from './difficulty';
import { FIG_ELEMENTS, movementToElement } from './elements';

describe('difficulty by the FIG rule', () => {
  it('reproduces every value of the Code of Points table of examples', () => {
    expect(OFFICIAL_EXAMPLES.length).toBeGreaterThan(130);
    const wrong = OFFICIAL_EXAMPLES.filter((e) => difficultyValue(exampleMovement(e)) !== e.difficulty).map(
      (e) => `${e.name} ${e.code}: rule ${difficultyValue(exampleMovement(e))}, Code ${e.difficulty}`,
    );
    expect(wrong).toEqual([]);
  });

  it('adds the somersaults, the twists and the bonuses, and says where each part comes from', () => {
    const d = difficultyOf({ direction: 'back', somersaults: 2, twists: 2, position: 'straight' });
    expect(d.value).toBe(1.7); // full in full out: 1.0 + 0.4 + 0.1 (backward) + 0.2 (straight)
    expect(d.parts.map((p) => p.rule)).toEqual(['17.1.1.2 to 17.1.1.5', '17.1.1.6', '17.1.6.1', '17.1.5']);
    expect(d.parts.reduce((s, p) => s + p.value, 0)).toBeCloseTo(d.value, 5);
  });

  it('rewards a layout or a pike single somersault only when it does not twist', () => {
    const single = (twists: number, position: 'tuck' | 'pike' | 'straight') =>
      difficultyValue({ direction: 'back', somersaults: 1, twists, position });
    expect(single(0, 'tuck')).toBe(0.5);
    expect(single(0, 'pike')).toBe(0.6);
    expect(single(0, 'straight')).toBe(0.6);
    expect(single(0.5, 'tuck')).toBe(0.6);
    expect(single(0.5, 'straight')).toBe(0.6);
  });

  it('gives a backward double or triple its bonus and a forward one none', () => {
    const at = (direction: 'front' | 'back', somersaults: number) =>
      difficultyValue({ direction, somersaults, twists: 0, position: 'tuck' });
    expect(at('back', 2) - at('front', 2)).toBeCloseTo(0.1, 5);
    expect(at('back', 3) - at('front', 3)).toBeCloseTo(0.2, 5);
    expect(at('back', 1)).toBe(at('front', 1));
  });

  it('values the jumps: a straight jump is worth nothing, a tuck or pike jump 0.1, a twist 0.1 per half', () => {
    const jump = (twists: number, position: 'tuck' | 'pike' | 'straight') =>
      difficultyValue({ direction: null, somersaults: 0, twists, position });
    expect(jump(0, 'straight')).toBe(0);
    expect(jump(0, 'tuck')).toBe(0.1);
    expect(jump(0, 'pike')).toBe(0.1);
    expect(jump(0.5, 'straight')).toBe(0.1);
    expect(jump(1.5, 'straight')).toBe(0.3);
  });

  it('gives a range over front and back when the direction is not known', () => {
    expect(difficultyRange({ direction: null, somersaults: 2, twists: 0, position: 'pike' })).toEqual({
      min: 1.2,
      max: 1.3,
    });
    expect(difficultyRange({ direction: 'back', somersaults: 1, twists: 0, position: 'tuck' })).toEqual({
      min: 0.5,
      max: 0.5,
    });
  });

  it('never gives a difficulty below the easier of two elements that differ by one more half twist', () => {
    for (const e of FIG_ELEMENTS) {
      const more = movementToElement({ ...e, twists: e.twists + 0.5 });
      if (more && e.somersaults > 0) expect(more.difficulty).toBeGreaterThanOrEqual(e.difficulty);
    }
  });
});

describe('the total of a set', () => {
  const back = { direction: 'back', somersaults: 1, twists: 0, position: 'tuck' } as const;
  const barani = { direction: 'front', somersaults: 1, twists: 0.5, position: 'tuck' } as const;

  it('sums the elements and counts a repetition once', () => {
    const t = totalDifficulty([back, barani, back, null]);
    expect(t.counted).toEqual([0.5, 0.6, 0, 0]);
    expect(t.repeated).toEqual([false, false, true, false]);
    expect(t.value).toBe(1.1);
  });

  it('treats another position as another element', () => {
    expect(totalDifficulty([back, { ...back, position: 'pike' }]).repeated).toEqual([false, false]);
  });
});
