import { describe, expect, it } from 'vitest';
import { bestIndex, compareJumpRows, type AthleteView } from './compare';

const view = (heights: number[]): AthleteView =>
  ({
    result: {},
    skills: {
      config: { minConfidence: 0.3 },
      jumps: heights.map((h) => ({
        prediction: { skill: 'tuck', label: 'Tuck', certainty: 'sure', confidence: 0.9 },
        features: { trajectory: { maxHeightM: h } },
      })),
    },
  }) as unknown as AthleteView;

describe('bestIndex', () => {
  it('points at the single highest value', () => {
    expect(bestIndex([1.2, 2.5, 2])).toBe(1);
  });
  it('points at nobody on a tie or without data', () => {
    expect(bestIndex([2, 2])).toBe(-1);
    expect(bestIndex([NaN, NaN])).toBe(-1);
  });
  it('ignores unknown values', () => {
    expect(bestIndex([NaN, 1])).toBe(1);
  });
});

describe('compareJumpRows', () => {
  it('puts the n-th jump of every athlete on one row, and leaves a gap for the one with fewer jumps', () => {
    const rows = compareJumpRows([view([3, 3.1, 3.2]), view([2.9])]);
    expect(rows).toHaveLength(3);
    expect(rows[0].cells.map((c) => c?.heightM)).toEqual([3, 2.9]);
    expect(rows[2].cells[1]).toBeNull();
    expect(rows[2].cells[0]?.label).toBe('Tuck');
  });
});
