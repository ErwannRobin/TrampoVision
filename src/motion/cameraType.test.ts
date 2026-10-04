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
  /** Frames (by number) where the camera estimate was not sure: the move is then given as nothing, like the detector does. */
  unsure: (frame: number) => boolean = () => false,
) {
  const kinds: string[] = [];
  let before = position(0);
  for (let f = 1; f <= Math.round(seconds * FPS); f++) {
    const t = f / FPS;
    const now = position(t);
    const doubt = unsure(f);
    const sample: CameraSample = {
      dt: 1 / FPS,
      dx: doubt ? 0 : now.x - before.x,
      dy: doubt ? 0 : now.y - before.y,
      known: !doubt,
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

  it('does not count a frame whose move could not be told as a camera that stood still', () => {
    const pan = (t: number) => ({ x: 12 * t, y: 0 });
    // Every other frame cannot be told, and the camera is still read as moving.
    expect(
      feed(
        8,
        pan,
        () => null,
        new CameraTypeEstimator(mergeMotionConfig()),
        (f) => f % 2 === 0,
      ).last,
    ).toBe('tracking');
    // A stretch of frames that cannot be told does not make it a still camera, and does not make a still camera a moving one.
    const stretch = feed(
      12,
      (t) => ({ x: 12 * Math.min(t, 5), y: 0 }),
      () => null,
      new CameraTypeEstimator(mergeMotionConfig()),
      (f) => f > 6 * FPS && f < 11 * FPS,
    );
    expect(stretch.kinds[Math.round(10 * FPS)]).toBe('tracking');
    const still = feed(
      10,
      () => ({ x: 0, y: 0 }),
      () => null,
      new CameraTypeEstimator(mergeMotionConfig()),
      (f) => f > 3 * FPS,
    );
    expect(still.kinds.every((k) => k === 'fixed')).toBe(true);
  });

  it('says what it measured: how fast the camera goes and how wide the athlete is', () => {
    const run = feed(
      10,
      (t) => ({ x: 10 * t, y: 0 }),
      () => 0.12,
    );
    expect(run.estimator.speed).toBeGreaterThan(0.1);
    expect(run.estimator.athleteShare).toBeCloseTo(0.12, 1);
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
    expect(feed(10, still, () => 0.45).last).toBe('lowAngle');
    expect(feed(10, still, () => 0.2).last).toBe('fixed');
  });

  it('does not flicker between kinds for a width that hovers between the two thresholds', () => {
    const wobble = noise(9);
    // Mean 0.33: between the low (0.30) and high (0.36) edge. It starts below, so it stays a wide shot.
    const run = feed(
      30,
      () => ({ x: 0, y: 0 }),
      () => 0.33 + 0.008 * wobble(),
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
