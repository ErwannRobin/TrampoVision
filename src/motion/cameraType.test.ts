import { describe, expect, it } from 'vitest';
import { CameraTypeEstimator, type CameraSample } from './cameraType';
import { DEFAULT_MOTION_CONFIG, mergeMotionConfig } from './config';

const FPS = 30;
const SHORT = 72;

/** A deterministic pseudo-random number in -1..1, so a test cannot pass or fail by luck. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Feeds `seconds` of frames, each given the camera's position (picture pixels) and the athlete's width; returns the kinds of shot seen. */
function feed(
  seconds: number,
  position: (t: number) => { x: number; y: number },
  athleteWidth: (t: number) => number | null = () => null,
  estimator = new CameraTypeEstimator(mergeMotionConfig()),
) {
  const kinds: string[] = [];
  let before = position(0);
  for (let f = 1; f <= Math.round(seconds * FPS); f++) {
    const t = f / FPS;
    const now = position(t);
    const sample: CameraSample = {
      dt: 1 / FPS,
      dx: now.x - before.x,
      dy: now.y - before.y,
      athleteWidthShare: athleteWidth(t),
    };
    // The picture moves the other way from the camera; the sign does not matter to the speed.
    kinds.push(estimator.push(sample, SHORT));
    before = now;
  }
  return { kinds, estimator, last: kinds[kinds.length - 1] };
}

describe('the kind of shot', () => {
  it('starts as a fixed camera', () => {
    expect(new CameraTypeEstimator(DEFAULT_MOTION_CONFIG).type).toBe('fixed');
  });

  it('keeps a camera that stands still a fixed one, with or without the shake of a hand', () => {
    expect(feed(20, () => ({ x: 0, y: 0 })).last).toBe('fixed');
    const jitter = noise(3);
    const shaking = feed(20, () => ({ x: jitter() * 1.2, y: jitter() * 1.2 }));
    expect(shaking.kinds.every((k) => k === 'fixed')).toBe(true);
  });

  it('reads a camera that follows the jumps as tracking, and says so within a few seconds', () => {
    // It goes up and down by 14 pixels with a jump of 1.1 s.
    const follow = feed(8, (t) => ({ x: 0, y: -14 * Math.sin((2 * Math.PI * t) / 1.1) ** 2 }));
    expect(follow.last).toBe('tracking');
    expect(follow.kinds.indexOf('tracking') / FPS).toBeLessThan(3);
  });

  it('reads a pan as tracking', () => {
    expect(feed(8, (t) => ({ x: 10 * t, y: 0 })).last).toBe('tracking');
    expect(feed(8, (t) => ({ x: 20 * Math.sin(t), y: 0 })).last).toBe('tracking');
  });

  it('goes back to fixed when the camera stops, after holding the kind for a while', () => {
    const moving = (t: number) => ({ x: t < 6 ? 12 * t : 72, y: 0 });
    const run = feed(14, moving);
    expect(run.kinds[Math.round(5.5 * FPS)]).toBe('tracking');
    expect(run.last).toBe('fixed');
  });

  it('reads a still camera with a big athlete as low-angle, and a small one as a wide shot', () => {
    const still = () => ({ x: 0, y: 0 });
    expect(feed(10, still, () => 0.38).last).toBe('lowAngle');
    expect(feed(10, still, () => 0.12).last).toBe('fixed');
  });

  it('does not flicker between kinds for a width that hovers between the two thresholds', () => {
    const wobble = noise(9);
    // Mean 0.185: between the low (0.17) and high (0.2) edge. It starts below, so it stays a wide shot.
    const run = feed(
      30,
      () => ({ x: 0, y: 0 }),
      () => 0.185 + 0.008 * wobble(),
    );
    expect(new Set(run.kinds).size).toBe(1);
  });

  it('forgets a width when the athlete is gone for a while', () => {
    const run = feed(
      30,
      () => ({ x: 0, y: 0 }),
      (t) => (t < 8 ? 0.4 : null),
    );
    expect(run.kinds[Math.round(7 * FPS)]).toBe('lowAngle');
    expect(run.last).toBe('fixed');
  });

  it('a moving camera is tracking whatever the size of the athlete', () => {
    expect(
      feed(
        8,
        (t) => ({ x: 12 * t, y: 0 }),
        () => 0.4,
      ).last,
    ).toBe('tracking');
  });

  it('starts again after a reset', () => {
    const run = feed(8, (t) => ({ x: 12 * t, y: 0 }));
    expect(run.last).toBe('tracking');
    run.estimator.reset();
    expect(run.estimator.type).toBe('fixed');
    expect(run.estimator.speed).toBe(0);
  });
});
