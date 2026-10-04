import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { trunkAngle, UprightTracker, wrapDegrees } from './upright';

const W = 640;
const H = 360;

/** A body whose trunk is 0.2 of the picture's height long, turned `deg` degrees clockwise about the hips at (0.5, 0.6). */
function body(deg: number, visibility = 1): Keypoint[] {
  const landmarks: Keypoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.6, visibility }));
  const rad = (deg * Math.PI) / 180;
  const length = 0.2 * H;
  // The shoulders are above the hips (negative y) when upright; turned clockwise they go to the right.
  const sx = (Math.sin(rad) * length) / W;
  const sy = (-Math.cos(rad) * length) / H;
  const side = 0.03;
  landmarks[LM.L_HIP] = { x: 0.5 - side, y: 0.6, visibility };
  landmarks[LM.R_HIP] = { x: 0.5 + side, y: 0.6, visibility };
  landmarks[LM.L_SHOULDER] = { x: 0.5 - side + sx, y: 0.6 + sy, visibility };
  landmarks[LM.R_SHOULDER] = { x: 0.5 + side + sx, y: 0.6 + sy, visibility };
  return landmarks;
}

/** A deterministic pseudo-random number in -1..1. */
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

describe('degrees', () => {
  it('wrap to -180..180 with 180 for upside down', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(190)).toBeCloseTo(-170);
    expect(wrapDegrees(-190)).toBeCloseTo(170);
    expect(wrapDegrees(540)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(720)).toBe(0);
  });
});

describe('the angle of a body in the picture', () => {
  it('is 0 for a body standing upright, 90 leaning to the right, -90 to the left, 180 upside down', () => {
    expect(trunkAngle(body(0), W, H)).toBeCloseTo(0, 5);
    expect(trunkAngle(body(90), W, H)).toBeCloseTo(90, 5);
    expect(trunkAngle(body(-90), W, H)).toBeCloseTo(-90, 5);
    expect(Math.abs(trunkAngle(body(180), W, H)!)).toBeCloseTo(180, 5);
    expect(trunkAngle(body(35), W, H)).toBeCloseTo(35, 5);
  });

  it('does not depend on the shape of the picture: a pixel is the same on both axes', () => {
    // The same body in a picture twice as wide: the angle is read in pixels, not in shares of the picture.
    const wide = body(45);
    for (const p of wide) p.x = 0.5 + (p.x - 0.5) / 2;
    expect(trunkAngle(wide, 2 * W, H)).toBeCloseTo(45, 4);
  });

  it('is nothing when the trunk is not seen, or has no length', () => {
    expect(trunkAngle(body(30, 0.1), W, H)).toBeNull();
    const folded = body(30);
    folded[LM.L_SHOULDER] = { ...folded[LM.L_HIP] };
    folded[LM.R_SHOULDER] = { ...folded[LM.R_HIP] };
    expect(trunkAngle(folded, W, H)).toBeNull();
  });
});

/** The turning of one somersault as the tracker is told it, with what the model makes of it: the angle read, as measured, or null when it lost the body. */
function run(
  frames: number,
  perFrame: number,
  reading: (frame: number, truth: number) => number | null,
  tracker = new UprightTracker(),
) {
  const errors: number[] = [];
  for (let f = 0; f < frames; f++) {
    const truth = f * perFrame;
    // What was predicted for this frame, before it is looked at.
    if (f > 0) errors.push(Math.abs(wrapDegrees(tracker.predict() - truth)));
    tracker.update(reading(f, truth));
  }
  return { errors, tracker };
}

describe('following the turn of an athlete', () => {
  it('knows nothing before it has seen the athlete, and says upright', () => {
    const tracker = new UprightTracker();
    expect(tracker.tracking).toBe(false);
    expect(tracker.predict()).toBe(0);
  });

  it('predicts a steady somersault a frame ahead, within a few degrees', () => {
    const { errors } = run(40, 15, (_, truth) => wrapDegrees(truth));
    // The rate is learnt in a few frames; after that the prediction is the next angle.
    expect(Math.max(...errors.slice(6))).toBeLessThan(3);
    expect(Math.max(...errors.slice(0, 6))).toBeLessThan(25);
  });

  it('predicts a turn to the left as well', () => {
    const { errors } = run(40, -18, (_, truth) => wrapDegrees(truth));
    expect(Math.max(...errors.slice(6))).toBeLessThan(3);
  });

  it('stays upright for an athlete who bounces with a body that wobbles a few degrees', () => {
    const wobble = noise(5);
    const { errors } = run(60, 0, () => 5 * wobble());
    expect(Math.max(...errors)).toBeLessThan(6);
  });

  it('is not led astray when the model puts the head where the feet are for some frames', () => {
    const flip = noise(9);
    // A frame in four is read turned over, which is what the model does to a body that is upside down and tucked.
    const { errors } = run(60, 15, (_, truth) => wrapDegrees(truth + (flip() > 0.5 ? 180 : 0)));
    expect(Math.max(...errors.slice(10))).toBeLessThan(25);
    // The same readings taken as they come would be 180° wrong in those frames: nothing is repaired without the tracker.
    expect(Math.max(...errors.slice(10))).toBeLessThan(180 - 25);
  });

  it('is not led astray when the readings are noisy as well as turned over', () => {
    const flip = noise(2);
    const jitter = noise(8);
    const { errors } = run(80, 14, (_, truth) => wrapDegrees(truth + 8 * jitter() + (flip() > 0.6 ? 180 : 0)));
    expect(Math.max(...errors.slice(10))).toBeLessThan(30);
  });

  it('carries the turn on through the frames the model lost, then catches the athlete again', () => {
    // The model finds nobody for six frames in the middle of a somersault (the inverted part, where it does worst).
    const { errors } = run(50, 15, (frame, truth) => (frame >= 20 && frame < 26 ? null : wrapDegrees(truth)));
    expect(Math.max(...errors.slice(10, 26))).toBeLessThan(25);
    expect(Math.max(...errors.slice(30))).toBeLessThan(3);
  });

  it('gives up when the athlete is lost for long: a body that is not seen is not one to turn the picture for', () => {
    const { tracker } = run(40, 15, (frame, truth) => (frame < 15 ? wrapDegrees(truth) : null));
    expect(tracker.tracking).toBe(false);
    expect(tracker.predict()).toBe(0);
  });

  it('starts again after a reset', () => {
    const { tracker } = run(20, 15, (_, truth) => wrapDegrees(truth));
    expect(tracker.tracking).toBe(true);
    tracker.reset();
    expect(tracker.tracking).toBe(false);
    expect(tracker.turn).toBe(0);
  });

  it('keeps the angle continuous: it goes past a whole turn with the athlete', () => {
    const { tracker } = run(60, 15, (_, truth) => wrapDegrees(truth));
    // Two and a half turns in: the wrapped prediction is the truth for the next frame.
    expect(Math.abs(wrapDegrees(tracker.predict() - 60 * 15))).toBeLessThan(3);
    expect(tracker.turn).toBeCloseTo(15, 0);
  });
});
