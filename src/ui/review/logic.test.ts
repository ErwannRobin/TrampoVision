import { describe, expect, it } from 'vitest';
import {
  checkCount,
  datasetMeta,
  describeCounts,
  HEAT_MAX,
  HEAT_MIN,
  heatStrength,
  jumpPlayRange,
  labelForKey,
  labelStatus,
  nextUnlabeled,
  reportCaveats,
  sparkLayout,
  summarizeDataset,
} from './logic';

describe('labelForKey', () => {
  it('maps keys 1 to 6 to the labels in the order they are listed', () => {
    expect(['1', '2', '3', '4', '5', '6'].map(labelForKey)).toEqual([
      'straight',
      'tuck',
      'pike',
      'back',
      'front',
      'unknown',
    ]);
  });
  it('ignores every other key', () => {
    for (const key of ['0', '7', '9', 'n', 'Enter', '10', '']) expect(labelForKey(key)).toBeNull();
  });
});

describe('nextUnlabeled', () => {
  it('goes to the next jump without a label and wraps around the clip', () => {
    expect(nextUnlabeled([true, false, true, false], 0)).toBe(1);
    expect(nextUnlabeled([true, false, true, false], 1)).toBe(3);
    expect(nextUnlabeled([false, true, true], 2)).toBe(0);
  });
  it('comes back to the current jump when it is the only one left', () => {
    expect(nextUnlabeled([true, false, true], 1)).toBe(1);
  });
  it('is null when everything is labeled or there is nothing to label', () => {
    expect(nextUnlabeled([true, true], 0)).toBeNull();
    expect(nextUnlabeled([], 0)).toBeNull();
  });
});

describe('jumpPlayRange', () => {
  it('starts before takeoff and ends after landing', () => {
    const [from, to] = jumpPlayRange({ takeoffTimeS: 2, apexTimeS: 2.5, landingTimeS: 3 });
    expect(from).toBeCloseTo(1.6);
    expect(to).toBeCloseTo(3.3);
  });
  it('uses the apex for an edge the clip cut off, and never starts before zero', () => {
    const [from, to] = jumpPlayRange({ takeoffTimeS: null, apexTimeS: 0.2, landingTimeS: null });
    expect(from).toBe(0);
    expect(to).toBeCloseTo(0.5);
  });
});

describe('labelStatus', () => {
  it('says why labels cannot be saved yet', () => {
    expect(labelStatus({ ready: false, labeled: false, saved: false })).toMatch(/reading the video id/i);
  });
  it('asks for a label, then confirms it is stored', () => {
    expect(labelStatus({ ready: true, labeled: false, saved: false })).toMatch(/choose/i);
    expect(labelStatus({ ready: true, labeled: true, saved: true })).toBe('Saved in this browser.');
    expect(labelStatus({ ready: true, labeled: true, saved: false })).toBe('');
  });
});

describe('heatStrength', () => {
  it('tints an empty cell not at all', () => {
    expect(heatStrength(0, 5)).toBe(0);
    expect(heatStrength(3, 0)).toBe(0);
  });
  it('grows with the count, within the readable range', () => {
    expect(heatStrength(1, 10)).toBeGreaterThan(HEAT_MIN);
    expect(heatStrength(1, 10)).toBeLessThan(heatStrength(5, 10));
    expect(heatStrength(10, 10)).toBeCloseTo(HEAT_MAX);
    expect(heatStrength(50, 10)).toBeCloseTo(HEAT_MAX);
  });
});

describe('sparkLayout', () => {
  const size = { width: 150, height: 40 };

  it('has nothing to draw without a value', () => {
    expect(sparkLayout([], size)).toBeNull();
    expect(sparkLayout([NaN, null], size)).toBeNull();
  });

  it('draws one line across the box, high values up', () => {
    const l = sparkLayout([0, 90, 180], size, { domain: [0, 180] });
    expect(l?.path).toBe('M2.0,37.0L75.0,20.0L148.0,3.0');
    expect(l?.min).toBe(0);
    expect(l?.max).toBe(180);
  });

  it('lifts the pen where a sample is missing', () => {
    const l = sparkLayout([1, 2, NaN, 4, null, 6], size, { domain: [0, 6] });
    expect(l?.path.match(/M/g)).toHaveLength(3);
    expect(l?.path).not.toContain('NaN');
  });

  it('keeps only the guides inside the drawn range', () => {
    const l = sparkLayout([0, 180], size, { domain: [0, 180], guides: [90, 300, -5] });
    expect(l?.guides).toEqual([20]);
  });

  it('stays finite for one sample and for a flat curve', () => {
    expect(sparkLayout([5], size)?.path).not.toContain('NaN');
    const flat = sparkLayout([2, 2, 2], size);
    expect(flat?.path).not.toContain('NaN');
    expect(flat?.max).toBe(2);
  });
});

describe('dataset wording', () => {
  const records = [
    { videoId: 'a', truth: null },
    { videoId: 'a', truth: { label: 'tuck' as const, labeledAt: '' } },
    { videoId: 'b', truth: { label: 'unknown' as const, labeledAt: '' } },
  ];

  it('counts jumps, videos and labels', () => {
    expect(summarizeDataset(records)).toEqual({ jumps: 3, videos: 2, labeled: 2 });
    expect(summarizeDataset([])).toEqual({ jumps: 0, videos: 0, labeled: 0 });
  });

  it('summarizes them for the closed row', () => {
    expect(datasetMeta({ jumps: 12, labeled: 5 })).toBe('12 jumps, 5 labeled');
    expect(datasetMeta({ jumps: 1, labeled: 0 })).toBe('1 jump, 0 labeled');
    expect(datasetMeta({ jumps: 0, labeled: 0 })).toBe('No saved jumps');
  });

  it('describes what a report covers', () => {
    expect(describeCounts({ records: 11, labeled: 7, known: 6, unknown: 1, unlabeled: 4 })).toBe(
      '11 saved jumps, 7 labeled (6 with one of the five skills, 1 Unknown), 4 unlabeled.',
    );
    expect(describeCounts({ records: 1, labeled: 0, known: 0, unknown: 0, unlabeled: 1 })).toMatch(/^1 saved jump,/);
  });
});

describe('reportCaveats', () => {
  it('always warns about training accuracy', () => {
    const notes = reportCaveats(120, [], 1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/training accuracy/);
  });

  it('warns about small samples, missing classes and mixed thresholds', () => {
    const notes = reportCaveats(1, ['Pike', 'Back'], 3);
    expect(notes).toHaveLength(4);
    expect(notes[0]).toMatch(/^Only 1 jump:/);
    expect(notes[1]).toBe('No example yet of: Pike, Back. Those rows have no recall.');
    expect(notes[2]).toMatch(/3 different threshold sets/);
    expect(notes[2]).toMatch(/Review tab/);
  });
});

describe('checkCount', () => {
  it('agrees with the number', () => {
    expect(checkCount(0)).toBe('0 checks differ');
    expect(checkCount(1)).toBe('1 check differs');
    expect(checkCount(3)).toBe('3 checks differ');
  });
});
