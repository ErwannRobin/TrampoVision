import { describe, expect, it } from 'vitest';
import { SCRUB_REFERENCE_PX, SCRUB_SPAN_S, scrubTime } from './scrub';

describe('scrubTime', () => {
  it('moves forward when the finger goes right and back when it goes left', () => {
    expect(scrubTime(5, 52, 390, 20)).toBeGreaterThan(5);
    expect(scrubTime(5, -52, 390, 20)).toBeLessThan(5);
    expect(scrubTime(5, 0, 390, 20)).toBe(5);
  });

  it('covers the span with a drag across the screen', () => {
    expect(scrubTime(5, 390, 390, 20)).toBeCloseTo(5 + SCRUB_SPAN_S);
    expect(scrubTime(5, SCRUB_REFERENCE_PX, SCRUB_REFERENCE_PX, 20)).toBeCloseTo(5 + SCRUB_SPAN_S);
  });

  it('does not get touchier on a wide screen', () => {
    expect(scrubTime(5, 100, 1600, 20)).toBe(scrubTime(5, 100, SCRUB_REFERENCE_PX, 20));
  });

  it('stays inside the clip', () => {
    expect(scrubTime(1, -400, 390, 20)).toBe(0);
    expect(scrubTime(19, 400, 390, 20)).toBe(20);
  });

  it('copes with a clip or a screen of no size', () => {
    expect(scrubTime(3, 100, 390, 0)).toBe(3);
    expect(scrubTime(3, 100, 390, NaN)).toBe(3);
    expect(Number.isFinite(scrubTime(3, 100, 0, 20))).toBe(true);
  });
});
