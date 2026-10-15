import { describe, expect, it } from 'vitest';
import { classify, scrubIndex, SLOP_PX, TAP_MS } from './gestures';

describe('what a touch on a video is', () => {
  it('is a tap when the finger lifts soon, where it went down', () => {
    expect(classify(2, -3, 120, true)).toBe('tap');
    expect(classify(0, 0, TAP_MS + 1, true)).toBe('undecided');
  });

  it('is nothing yet while the finger has not moved', () => {
    expect(classify(3, 4, 50, false)).toBe('undecided');
  });

  it('moves the position when the finger goes sideways, and scrolls the page when it goes up or down', () => {
    expect(classify(SLOP_PX + 1, 4, 80, false)).toBe('scrub');
    expect(classify(-SLOP_PX - 1, 4, 80, false)).toBe('scrub');
    expect(classify(4, SLOP_PX + 1, 80, false)).toBe('scroll');
    expect(classify(-6, -SLOP_PX, 80, true)).toBe('scroll');
  });
});

describe('where a slide lands', () => {
  it('goes through the whole clip across the width of the video', () => {
    expect(scrubIndex(0, 400, 400, 1000)).toBe(999);
    expect(scrubIndex(500, -200, 400, 1000)).toBe(0);
    expect(scrubIndex(500, 40, 400, 1000)).toBe(600);
  });

  it('stays in the clip', () => {
    expect(scrubIndex(10, -100, 400, 100)).toBe(0);
    expect(scrubIndex(90, 100, 400, 100)).toBe(99);
    expect(scrubIndex(0, 10, 0, 1)).toBe(0);
  });
});
