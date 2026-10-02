import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_JUMP_S, SCRUB_REFERENCE_PX, SCRUB_SPAN_S, jumpTime, scrubTime, tapSide } from './scrub';

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

describe('tapSide', () => {
  it('goes back on the left third and forward on the right third', () => {
    expect(tapSide(10, 0, 390)).toBe('back');
    expect(tapSide(129, 0, 390)).toBe('back');
    expect(tapSide(381, 0, 390)).toBe('forward');
    expect(tapSide(261, 0, 390)).toBe('forward');
  });

  it('leaves the middle third to the single tap', () => {
    expect(tapSide(195, 0, 390)).toBeNull();
    expect(tapSide(131, 0, 390)).toBeNull();
    expect(tapSide(259, 0, 390)).toBeNull();
  });

  it('counts from the left edge of the picture, not of the screen', () => {
    expect(tapSide(110, 100, 390)).toBe('back');
    expect(tapSide(295, 100, 390)).toBeNull();
    expect(tapSide(480, 100, 390)).toBe('forward');
  });

  it('copes with a picture of no width', () => {
    expect(tapSide(5, 0, 0)).toBeNull();
    expect(tapSide(5, 0, NaN)).toBeNull();
  });
});

describe('jumpTime', () => {
  it('jumps a few seconds each way', () => {
    expect(jumpTime(10, 'forward', 30)).toBe(10 + DOUBLE_TAP_JUMP_S);
    expect(jumpTime(10, 'back', 30)).toBe(10 - DOUBLE_TAP_JUMP_S);
  });

  it('stops at the ends of the clip', () => {
    expect(jumpTime(1, 'back', 30)).toBe(0);
    expect(jumpTime(29, 'forward', 30)).toBe(30);
  });

  it('copes with a clip of no known length', () => {
    expect(jumpTime(4, 'forward', 0)).toBe(4);
    expect(jumpTime(4, 'back', NaN)).toBe(4);
  });
});
