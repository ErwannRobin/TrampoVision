import { describe, expect, it } from 'vitest';
import { analysisStride } from '../analysis/stride';
import { maskedName, resultPlan } from './resultVideo';

describe('the frames of the result video', () => {
  it('are all the frames of a clip at 30 a second, at 30 a second', () => {
    expect(resultPlan(10, 30, 1)).toEqual({ frames: 300, fps: 30 });
  });

  it('are every second frame of a clip at 60, so the result plays at 30 and every frame keeps its time', () => {
    const plan = resultPlan(10, 60, analysisStride(60));
    expect(plan).toEqual({ frames: 300, fps: 30 });
    // Frame k of the result is the clip's frame 2k, at 2k / 60 s: the same instant.
    expect(7 / plan.fps).toBeCloseTo((7 * 2) / 60, 9);
  });

  it('keep the odd rates of a phone as they are', () => {
    const plan = resultPlan(4, 59.94, analysisStride(59.94));
    expect(plan.fps).toBeCloseTo(29.97, 9);
    expect(plan.frames).toBe(Math.floor((4 * 59.94) / 2));
  });

  it('are as many as the app counts when it analyzes the clip, so the two have the same timeline', () => {
    for (const fps of [24, 25, 29.97, 30, 50, 60, 120, 240]) {
      const stride = analysisStride(fps);
      // `extractPoseTracks` counts a clip the same way.
      expect(resultPlan(12.4, fps, stride).frames).toBe(Math.max(1, Math.floor((12.4 * fps) / stride)));
    }
  });

  it('are at least one, even for a clip that is shorter than a frame', () => {
    expect(resultPlan(0.001, 30, 1).frames).toBe(1);
  });
});

describe('the name of the result video', () => {
  it('is the name of the clip with -masked and the MP4 extension', () => {
    expect(maskedName('IMG_8368.mp4')).toBe('IMG_8368-masked.mp4');
    expect(maskedName('IMG_8368.MOV')).toBe('IMG_8368-masked.mp4');
  });

  it('keeps the dots that are part of the name', () => {
    expect(maskedName('dong.dong.2011.mp4')).toBe('dong.dong.2011-masked.mp4');
  });

  it('has a name when the clip has none, and when it has no extension', () => {
    expect(maskedName('')).toBe('video-masked.mp4');
    expect(maskedName('clip')).toBe('clip-masked.mp4');
  });
});
