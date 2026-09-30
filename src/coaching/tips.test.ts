import { describe, expect, it } from 'vitest';
import type { JumpFeatures } from '../skills/types';
import type { Deduction, Execution } from './execution';
import { DRIFT_BED, DRIFT_M, focusOf, tipsForJump, type Tip } from './tips';

const d = (id: Deduction['id'], value: number, label = 'x'): Deduction => ({
  id,
  label,
  value,
  detail: `detail of ${id}`,
  measure: { name: 'm', value: 1, limit: 2, unit: 'deg' },
  rule: '20.2',
});
const exec = (items: Deduction[]): Execution => ({
  checked: true,
  reason: null,
  deduction: items.reduce((s, i) => s + i.value, 0),
  items,
  unchecked: [],
  quality: 1,
  ruleset: 'test',
});
const features = (over: Partial<JumpFeatures['trajectory']> = {}, complete = true): JumpFeatures =>
  ({
    complete,
    trajectory: { landingXBed: null, horizontalDisplacementM: null, ...over },
  }) as JumpFeatures;

describe('tips of a skill', () => {
  it('gives one tip per deduction, the ones worth the most first, each with what was measured', () => {
    const tips = tipsForJump(2, exec([d('knees', 0.1), d('opening', 0.3, 'No opening'), d('arms', 0.1)]), features());
    expect(tips.map((t) => t.id)).toEqual(['opening', 'knees', 'arms']);
    expect(tips[0]).toMatchObject({ jump: 2, gain: 0.3, title: 'Open before you land', detail: 'detail of opening' });
    expect(tips[1].text.length).toBeGreaterThan(10);
  });

  it('tells a late opening from a missing one', () => {
    expect(tipsForJump(0, exec([d('opening', 0.1, 'Late opening')]), features())[0].title).toBe('Open earlier');
  });

  it('adds a tip, worth nothing, when the skill landed far from the center of the bed', () => {
    const drift = tipsForJump(0, exec([]), features({ landingXBed: -0.7 }));
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ id: 'drift', gain: 0 });
    expect(drift[0].detail).toBe('Landed 70% of the way to the left edge of the bed.');
    expect(tipsForJump(0, exec([]), features({ landingXBed: 1.2 }))[0].detail).toMatch(/past the right edge/);
    expect(tipsForJump(0, exec([]), features({ landingXBed: DRIFT_BED - 0.1 }))).toEqual([]);
  });

  it('uses the distance travelled when the bed is not marked, and never both', () => {
    const t = tipsForJump(0, exec([]), features({ horizontalDisplacementM: 0.9 }));
    expect(t[0].detail).toBe('Travelled 0.9 m to the right in the picture during the skill.');
    expect(tipsForJump(0, exec([]), features({ horizontalDisplacementM: DRIFT_M - 0.1 }))).toEqual([]);
    expect(tipsForJump(0, exec([]), features({ landingXBed: 0.1, horizontalDisplacementM: 2 }))).toEqual([]);
  });

  it('has nothing to say about a jump that could not be judged', () => {
    expect(tipsForJump(0, null, features({}, false))).toEqual([]);
  });
});

describe('focus of a set', () => {
  const tip = (id: Tip['id'], jump: number, gain: number): Tip => ({
    id,
    jump,
    gain,
    title: `title ${id}`,
    text: `text ${id}`,
    detail: `detail ${id}`,
  });

  it('puts what costs the most points first, and says how often', () => {
    const f = focusOf(
      [
        tip('knees', 0, 0.1),
        tip('opening', 1, 0.2),
        tip('opening', 2, 0.2),
        tip('opening', 4, 0.1),
        tip('arms', 3, 0.1),
      ],
      8,
    );
    expect(f.map((x) => x.id)).toEqual(['opening', 'knees']);
    expect(f[0]).toMatchObject({ jumps: [1, 2, 4], gain: 0.5, title: 'title opening' });
    expect(f[0].summary).toBe('3 of 8 skills, 0.5 points');
  });

  it('breaks a tie by how many skills it concerns, and shows the measurement for a set-wide note', () => {
    const f = focusOf([tip('knees', 0, 0.1), tip('arms', 1, 0.1), tip('arms', 2, 0)], 4, 3);
    expect(f.map((x) => x.id)).toEqual(['arms', 'knees']);
    const height = focusOf([{ ...tip('height', -1, 0), detail: 'Fell from 1.8 s to 1.5 s.' }], 8);
    expect(height[0].summary).toBe('Fell from 1.8 s to 1.5 s.');
  });

  it('gives the cue of the skill that lost the most', () => {
    const late = { ...tip('opening', 0, 0.1), title: 'Open earlier' };
    const never = { ...tip('opening', 1, 0.3), title: 'Open before you land' };
    expect(focusOf([late, never], 4)[0].title).toBe('Open before you land');
  });

  it('gives at most the requested number', () => {
    expect(focusOf([tip('knees', 0, 0.1), tip('arms', 1, 0.1), tip('opening', 2, 0.1)], 3, 2)).toHaveLength(2);
    expect(focusOf([], 3)).toEqual([]);
  });
});
