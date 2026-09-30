import { describe, expect, it } from 'vitest';
import { analysisStride } from './stride';

describe('the frames analyzed in the live view', () => {
  it('keeps every frame of a video at 30 fps or less', () => {
    expect(analysisStride(24)).toBe(1);
    expect(analysisStride(30)).toBe(1);
    expect(analysisStride(29.97)).toBe(1);
  });

  it('analyzes about 30 frames a second of a faster video', () => {
    expect(analysisStride(60)).toBe(2);
    expect(analysisStride(59.94)).toBe(2);
    expect(analysisStride(120)).toBe(4);
    expect(analysisStride(240)).toBe(8);
  });

  it('never skips more than eight frames, and never breaks on a bad rate', () => {
    expect(analysisStride(1000)).toBe(8);
    expect(analysisStride(NaN)).toBe(1);
    expect(analysisStride(0)).toBe(1);
  });
});
