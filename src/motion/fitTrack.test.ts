import { describe, expect, it } from 'vitest';
import type { PoseTrack } from '../analysis/types';
import { fitTrackToClip } from './fitTrack';

const masked: PoseTrack = {
  width: 640,
  height: 360,
  fps: 30,
  sourceFps: 30,
  times: [0, 1 / 30],
  frames: [[{ x: 320, y: 90, visibility: 0.9 }], null],
  world: [[{ x: 0, y: 0, z: 0, visibility: 1 }], null],
  backend: 'mediapipe (GPU)',
};

describe('a track made from the masked copy of a clip', () => {
  const fitted = fitTrackToClip(masked, { width: 1920, height: 1080, sourceFps: 60, stride: 2 });

  it('is in the pixels of the clip', () => {
    expect([fitted.width, fitted.height]).toEqual([1920, 1080]);
    expect(fitted.frames[0]?.[0]).toEqual({ x: 960, y: 270, visibility: 0.9 });
  });

  it('keeps the frames where nobody was found', () => {
    expect(fitted.frames[1]).toBeNull();
  });

  it('has the rates of the clip', () => {
    expect(fitted.sourceFps).toBe(60);
    expect(fitted.fps).toBe(30);
  });

  it('leaves the times, the 3D landmarks and the input as they were', () => {
    expect(fitted.times).toEqual(masked.times);
    expect(fitted.world).toBe(masked.world);
    expect(masked.frames[0]?.[0].x).toBe(320);
  });
});
