import { describe, expect, it } from 'vitest';
import { estimateRemaining, formatRemaining } from './eta';

describe('estimateRemaining', () => {
  it('says nothing before 8% or before 4 seconds', () => {
    expect(estimateRemaining(10, 0.05)).toBeNull();
    expect(estimateRemaining(3.9, 0.5)).toBeNull();
    expect(estimateRemaining(0, 0)).toBeNull();
  });

  it('projects the pace so far, rounded to 5 seconds', () => {
    // 10 s for a quarter of the work leaves 30 s.
    expect(estimateRemaining(10, 0.25)).toBe(30);
    // 12 s for 30% leaves 28 s, shown as 30.
    expect(estimateRemaining(12, 0.3)).toBe(30);
    // 4 s for 10% leaves 36 s, shown as 35.
    expect(estimateRemaining(4, 0.1)).toBe(35);
  });

  it('reaches zero when the work is done', () => {
    expect(estimateRemaining(20, 1)).toBe(0);
    expect(estimateRemaining(20, 1.2)).toBe(0);
  });

  it('ignores values that are not numbers', () => {
    expect(estimateRemaining(NaN, 0.5)).toBeNull();
    expect(estimateRemaining(10, NaN)).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('speaks in seconds under a minute', () => {
    expect(formatRemaining(40)).toBe('About 40 s left');
    expect(formatRemaining(5)).toBe('About 5 s left');
  });

  it('speaks in minutes from a minute on', () => {
    expect(formatRemaining(60)).toBe('About 1 min left');
    expect(formatRemaining(95)).toBe('About 1 min 35 s left');
    expect(formatRemaining(300)).toBe('About 5 min left');
  });

  it('does not count down to nothing', () => {
    expect(formatRemaining(0)).toBe('Almost done');
  });
});
