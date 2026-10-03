import { describe, expect, it } from 'vitest';
import { CameraMotion } from './camera';
import { mergeMotionConfig } from './config';
import { ONE_ATHLETE, sceneFrames, type SceneSpec } from './testScenes';

/**
 * Runs the camera estimator over a scene whose camera path is known and returns the error of every estimate that was made. `truth` is how
 * the picture moves between two frames: the opposite of the camera (a camera that looks further right sees the scene move left).
 */
function errors(spec: SceneSpec, truth: { dx: number; dy: number }) {
  const camera = new CameraMotion(spec.width, spec.height, mergeMotionConfig());
  const out: { dx: number; dy: number; ok: boolean }[] = [];
  for (const { frame } of sceneFrames(spec)) {
    const estimate = camera.step(frame.data, null);
    if (estimate)
      out.push({ dx: Math.abs(estimate.dx - truth.dx), dy: Math.abs(estimate.dy - truth.dy), ok: estimate.ok });
  }
  return out;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const short = { ...ONE_ATHLETE, seconds: 4 };

describe('how far the picture moved between two frames', () => {
  it('finds nothing for a camera that stands still', () => {
    const e = errors(short, { dx: 0, dy: 0 });
    expect(e.every((x) => x.ok)).toBe(true);
    expect(Math.max(...e.map((x) => x.dx), ...e.map((x) => x.dy))).toBeLessThan(0.05);
  });

  it('finds a slow pan, in both directions at once, to a fraction of a pixel', () => {
    // 9 and 6 pixels a second at 30 frames a second: the scene goes 0.3 left and 0.2 up between two frames.
    const e = errors({ ...short, camera: { kind: 'pan', vx: 9, vy: 6 } }, { dx: -0.3, dy: -0.2 });
    expect(e.every((x) => x.ok)).toBe(true);
    expect(mean(e.map((x) => x.dx))).toBeLessThan(0.06);
    expect(mean(e.map((x) => x.dy))).toBeLessThan(0.06);
  });

  it('finds a fast tilt of three pixels a frame, which is what a camera that follows a high jump does', () => {
    const e = errors({ ...short, seconds: 3, camera: { kind: 'pan', vx: 0, vy: 90 } }, { dx: 0, dy: -3 });
    // The first frames have no earlier move to start from; after them nearly all are right.
    const wrong = e.slice(3).filter((x) => x.dy > 0.3 || x.dx > 0.3).length;
    expect(wrong).toBeLessThanOrEqual(2);
    expect(mean(e.slice(3).map((x) => x.dy))).toBeLessThan(0.1);
  });

  it('is not led astray by an athlete in the middle of the picture, even a big one', () => {
    const big = [{ x: 64, bedY: 66, size: 60, periodS: 1.1, apex: 10, startS: 0.5 }];
    const e = errors({ ...short, jumpers: big, camera: { kind: 'pan', vx: 9, vy: 6 } }, { dx: -0.3, dy: -0.2 });
    expect(mean(e.map((x) => x.dx))).toBeLessThan(0.1);
    expect(mean(e.map((x) => x.dy))).toBeLessThan(0.1);
  });

  it('does not make up a move when there is nothing on the picture to follow', () => {
    // A wall with no texture, and the bed out of the picture: only the noise of the video is left. It finds no move, and the true
    // one (0.3 pixels a frame) is nothing the detector could have seen either.
    const bare: SceneSpec = {
      ...short,
      texture: 0,
      jumpers: [{ x: 64, bedY: 120, size: 22, periodS: 1.1, apex: 0, startS: 99 }],
      camera: { kind: 'pan', vx: 9 },
    };
    const e = errors(bare, { dx: 0, dy: 0 });
    expect(Math.max(...e.map((x) => x.dx), ...e.map((x) => x.dy))).toBeLessThan(0.1);
  });

  it('forgets the last frame on reset: the next frame has nothing to be compared with', () => {
    const camera = new CameraMotion(short.width, short.height, mergeMotionConfig());
    const frames = Array.from(sceneFrames({ ...short, seconds: 1 }), (f) => f.frame.data);
    camera.step(frames[0], null);
    expect(camera.step(frames[1], null)).not.toBeNull();
    camera.reset();
    expect(camera.step(frames[2], null)).toBeNull();
  });
});
