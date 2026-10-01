import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../../analysis/computeAnalysis';
import { EMPTY_ANSWERS, type ReviewStatus } from '../../../dataset/stageLabel';
import { analyzeSkills } from '../../../skills/analyzeSkills';
import { DEFAULT_SKILL_CONFIG } from '../../../skills/config';
import { mannequinRoutine } from '../../../skills/testMannequin';
import {
  answer,
  dataFlags,
  filterMask,
  matchesFilter,
  nextToLabel,
  reviewCounts,
  reviewKey,
  stepInMask,
  type ReviewItem,
} from './logic';

const item = (status: ReviewStatus, over: Partial<ReviewItem> = {}): ReviewItem => ({
  status,
  disagrees: false,
  confidence: 0.8,
  ...over,
});

describe('the filters', () => {
  const items = [
    item('done'),
    item('unlabeled', { confidence: 0.1 }),
    item('partial'),
    item('done', { disagrees: true, confidence: 0.2 }),
    item('cannot-tell'),
  ];

  it('pick the jumps that still need a label, the ones that disagree, and the ones that are not confident', () => {
    expect(filterMask('all', items, 0.6)).toEqual([true, true, true, true, true]);
    expect(filterMask('todo', items, 0.6)).toEqual([false, true, true, false, false]);
    expect(filterMask('disagree', items, 0.6)).toEqual([false, false, false, true, false]);
    expect(filterMask('unsure', items, 0.6)).toEqual([false, true, false, true, false]);
    expect(matchesFilter('unsure', item('done', { confidence: 0.6 }), 0.6)).toBe(false);
  });

  it('move to the next or previous jump of the mask, wrapping, and to nothing when there is no other', () => {
    const mask = [false, true, false, true, false];
    expect(stepInMask(mask, 0)).toBe(1);
    expect(stepInMask(mask, 1)).toBe(3);
    expect(stepInMask(mask, 3)).toBe(1);
    expect(stepInMask(mask, 1, -1)).toBe(3);
    expect(stepInMask(mask, 4, -1)).toBe(3);
    expect(stepInMask([false, true, false], 1)).toBeNull();
    expect(stepInMask([], 0)).toBeNull();
  });

  it('advance, after a label, to the next jump of the filter that still needs one', () => {
    const statuses: ReviewStatus[] = ['done', 'unlabeled', 'done', 'partial', 'cannot-tell'];
    const all = [true, true, true, true, true];
    expect(nextToLabel(statuses, all, 0)).toBe(1);
    expect(nextToLabel(statuses, all, 1)).toBe(3);
    expect(nextToLabel(statuses, all, 3)).toBe(1); // wraps
    expect(nextToLabel(statuses, [true, false, true, false, true], 0)).toBeNull();
    expect(nextToLabel(['done', 'done'], [true, true], 0)).toBeNull();
  });

  it('count what is done, flagged, partial and open', () => {
    const statuses: ReviewStatus[] = ['done', 'done', 'cannot-tell', 'bad-segmentation', 'partial', 'unlabeled'];
    expect(reviewCounts(statuses)).toEqual({ total: 6, done: 2, flagged: 2, partial: 1, open: 1, settled: 4 });
  });
});

describe('answering', () => {
  it('sets one question at a time, and clears the direction of a body that does not somersault', () => {
    let a = answer(EMPTY_ANSWERS, { kind: 'somersaults', value: 2 })!;
    a = answer(a, { kind: 'direction', value: 'back' })!;
    a = answer(a, { kind: 'position', value: 'pike' })!;
    a = answer(a, { kind: 'twistsStep', delta: 1 })!;
    expect(a).toEqual({ somersaults: 2, direction: 'back', halfTwists: 1, position: 'pike' });
    expect(answer(a, { kind: 'somersaults', value: 0 })).toEqual({
      somersaults: 0,
      direction: null,
      halfTwists: 1,
      position: 'pike',
    });
  });

  it('takes an answer back when a button is pressed twice, but not a key', () => {
    const a = { ...EMPTY_ANSWERS, position: 'tuck' as const };
    expect(answer(a, { kind: 'position', value: 'tuck' }, { toggle: true })?.position).toBeNull();
    expect(answer(a, { kind: 'position', value: 'tuck' })?.position).toBe('tuck');
  });

  it('goes up the quarters with Q and stays inside the offered half twists', () => {
    let a = answer({ ...EMPTY_ANSWERS, somersaults: 1 }, { kind: 'quarter' })!;
    expect(a.somersaults).toBe(1.25);
    a = answer(a, { kind: 'quarter' })!;
    a = answer(a, { kind: 'quarter' })!;
    a = answer(a, { kind: 'quarter' })!;
    expect(a.somersaults).toBe(1);
    expect(answer({ ...EMPTY_ANSWERS, halfTwists: 8 }, { kind: 'twistsStep', delta: 1 })?.halfTwists).toBe(8);
    expect(answer(EMPTY_ANSWERS, { kind: 'twistsStep', delta: -1 })?.halfTwists).toBe(0);
  });

  it('has no answer for an action that is not a question', () => {
    expect(answer(EMPTY_ANSWERS, { kind: 'accept' })).toBeNull();
  });
});

describe('the keys', () => {
  const key = (k: string, extra: Record<string, boolean> = {}) => reviewKey({ key: k, ...extra });

  it('answer the four questions', () => {
    expect(key('2')).toEqual({ kind: 'somersaults', value: 2 });
    expect(key('4')).toBeNull();
    expect(key('q')).toEqual({ kind: 'quarter' });
    expect(key('B')).toEqual({ kind: 'direction', value: 'back' });
    expect(key('f')).toEqual({ kind: 'direction', value: 'front' });
    expect(key('s')).toEqual({ kind: 'position', value: 'straight' });
    expect(key('t')).toEqual({ kind: 'position', value: 'tuck' });
    expect(key('P')).toEqual({ kind: 'position', value: 'pike' });
    expect(key('w')).toEqual({ kind: 'twists', value: 0 });
    expect(key('+')).toEqual({ kind: 'twistsStep', delta: 1 });
    expect(key('-')).toEqual({ kind: 'twistsStep', delta: -1 });
  });

  it('accept, mark, clear, undo, move on and replay', () => {
    expect(key('Enter')).toEqual({ kind: 'accept' });
    expect(key('a')).toEqual({ kind: 'accept' });
    expect(key('u')).toEqual({ kind: 'cannotTell' });
    expect(key('x')).toEqual({ kind: 'badSegmentation' });
    expect(key('c')).toEqual({ kind: 'clear' });
    expect(key('z')).toEqual({ kind: 'undo' });
    expect(key('z', { metaKey: true })).toEqual({ kind: 'undo' });
    expect(key('Z', { ctrlKey: true })).toEqual({ kind: 'undo' });
    expect(key('n')).toEqual({ kind: 'next' });
    expect(key('r')).toEqual({ kind: 'replay' });
  });

  it('leave the player, the timeline and the browser alone', () => {
    for (const k of [' ', 'ArrowLeft', 'ArrowRight', '[', ']', '?', 'Tab']) expect(key(k)).toBeNull();
    expect(key('s', { ctrlKey: true })).toBeNull();
    expect(key('t', { metaKey: true })).toBeNull();
    expect(key('1', { altKey: true })).toBeNull();
  });
});

describe('the data flags', () => {
  const { track } = mannequinRoutine({ jumps: [{ v0: 4.8, turns: -1, shape: 'tuck', facing: 1 }], facing: 1 });
  const skills = analyzeSkills(computeAnalysis(track, { athleteHeightM: 1.75 }));
  const f = skills.jumps[0].features;

  it('say nothing about a clean jump except the twist that is not measured', () => {
    expect(dataFlags(f, DEFAULT_SKILL_CONFIG, null).map((x) => x.id)).toEqual(['twist']);
    expect(dataFlags(f, DEFAULT_SKILL_CONFIG, { available: true, reliable: true })).toEqual([]);
  });

  it('point out a flipped orientation, a reversal, poor joints and a camera that is not side-on', () => {
    const bad = {
      ...f,
      rotation: { ...f.rotation, maxStepDeg: 140, reversalDeg: 80, crossCheckDiffDeg: -120 },
      quality: { ...f.quality, pose: 0.4, trunkLengthVariation: 0.6 },
      facing: { ...f.facing, sign: 0 as const, confidence: 0.1 },
    };
    expect(dataFlags(bad, DEFAULT_SKILL_CONFIG, { available: true, reliable: true }).map((x) => x.id)).toEqual([
      'flip',
      'reversal',
      'cross-check',
      'pose',
      'view',
      'facing',
    ]);
  });

  it('only say the jump is cut off when it is', () => {
    expect(dataFlags({ ...f, complete: false }, DEFAULT_SKILL_CONFIG, null)).toEqual([{ id: 'cut-off', value: null }]);
  });
});
