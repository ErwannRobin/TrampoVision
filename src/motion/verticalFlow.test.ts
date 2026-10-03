import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION_CONFIG } from './config';
import { VerticalFlow } from './verticalFlow';

const W = 64;
const H = 48;

/** A smooth texture with edges in every direction, moved down by `shift` pixels (exact, whatever the fraction). */
const wall = (x: number, y: number, shift: number, texture = 1) =>
  0.55 + texture * (0.08 * Math.sin(0.7 * x + 0.5 * (y - shift)) + 0.08 * Math.sin(0.31 * x - 0.9 * (y - shift)));

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The wall and a dark box in front of it (edges one pixel soft). */
function picture(box: Box, shift = 0, texture = 1, noise?: () => number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = Math.max(
        0,
        Math.min(1, Math.min(x - box.x0 + 0.5, box.x1 - x + 0.5, y - box.y0 + 0.5, box.y1 - y + 0.5)),
      );
      out[y * W + x] = wall(x, y, shift, texture) * (1 - inside) + 0.1 * inside + (noise ? 0.004 * noise() : 0);
    }
  }
  return out;
}

const still: Box = { x0: 26, y0: 14, x1: 36, y1: 30 };
const moved = (dx: number, dy: number): Box => ({
  x0: still.x0 + dx,
  y0: still.y0 + dy,
  x1: still.x1 + dx,
  y1: still.y1 + dy,
});

/** The motion after two frames. */
function twoFrames(first: Float32Array, second: Float32Array) {
  const flow = new VerticalFlow(W, H, { ...DEFAULT_MOTION_CONFIG });
  const motion = new Float32Array(W * H);
  expect(flow.step(first, motion)).toBeNull();
  const noise = flow.step(second, motion);
  return { motion, noise, flow };
}

/** The mean motion over the rows around the box's top and bottom edges (where its vertical motion shows). */
function edgeMotion(motion: Float32Array, box: Box): number {
  let sum = 0;
  let n = 0;
  for (const edge of [box.y0, box.y1]) {
    for (let y = Math.floor(edge) - 2; y <= Math.ceil(edge) + 2; y++) {
      for (let x = Math.ceil(box.x0) + 2; x <= Math.floor(box.x1) - 2; x++) {
        sum += motion[y * W + x];
        n++;
      }
    }
  }
  return sum / n;
}

const active = (motion: Float32Array, level = 0.3) => motion.filter((m) => Math.abs(m) >= level).length / motion.length;

/** A small deterministic noise. */
function noiseSource(seed: number): () => number {
  let a = seed;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return (a / 4294967296 - 0.5) * 3.4;
  };
}

describe('vertical motion between two pictures', () => {
  it('reads a body that moves down as positive, and one that moves up as negative', () => {
    const down = twoFrames(picture(still), picture(moved(0, 1)));
    expect(edgeMotion(down.motion, still)).toBeGreaterThan(0.5);
    const up = twoFrames(picture(still), picture(moved(0, -1)));
    expect(edgeMotion(up.motion, still)).toBeLessThan(-0.5);
  });

  it('keeps the sign when the body moves much farther than its edge is wide', () => {
    const jump = twoFrames(picture(still), picture(moved(0, -5)));
    expect(edgeMotion(jump.motion, still)).toBeLessThan(-0.3);
  });

  it('sees no vertical motion where things move sideways', () => {
    const sideways = twoFrames(picture(still), picture(moved(2, 0)));
    expect(active(sideways.motion)).toBeLessThan(0.005);
  });

  it('sees nothing in a picture that does not change, noise or not', () => {
    const random = noiseSource(5);
    const noisy = twoFrames(picture(still, 0, 1, random), picture(still, 0, 1, random));
    expect(active(noisy.motion, 0.1)).toBeLessThan(0.005);
    // The noise it measures is about the noise there is (the difference of two frames, a little blurred).
    expect(noisy.noise).toBeGreaterThan(0.001);
    expect(noisy.noise).toBeLessThan(0.006);
  });

  it('takes out a shake of the whole picture, and says how far it moved', () => {
    // The camera moved: the box moves with the wall.
    const shaken = twoFrames(picture(still, 0), picture(moved(0, 0.4), 0.4));
    expect(shaken.flow.shift).toBeGreaterThan(0.2);
    expect(shaken.flow.shift).toBeLessThan(0.6);
    expect(active(shaken.motion)).toBeLessThan(0.005);
  });

  it('still sees the body that moves while the camera shakes', () => {
    // The box jumped up by 3 pixels and the camera moved down by 0.4: the box moved up by 2.6 against the wall.
    const both = twoFrames(picture(still, 0), picture(moved(0, -2.6), 0.4));
    expect(edgeMotion(both.motion, still)).toBeLessThan(-0.3);
  });

  it('does not mistake a body on a plain wall for a shake', () => {
    const plain = twoFrames(picture(still, 0, 0), picture(moved(0, 2), 0, 0));
    expect(plain.flow.shift).toBe(0);
    expect(edgeMotion(plain.motion, still)).toBeGreaterThan(0.3);
  });

  it('is not moved by a light that gets brighter everywhere', () => {
    const brighter = picture(still).map((v) => v + 0.03);
    expect(active(twoFrames(picture(still), brighter).motion)).toBeLessThan(0.005);
  });

  it('starts again after a reset: the next picture has nothing to be compared with', () => {
    const flow = new VerticalFlow(W, H, { ...DEFAULT_MOTION_CONFIG });
    const motion = new Float32Array(W * H);
    flow.step(picture(still), motion);
    expect(flow.step(picture(moved(0, 1)), motion)).not.toBeNull();
    flow.reset();
    expect(flow.step(picture(moved(0, 2)), motion)).toBeNull();
    expect(active(motion)).toBe(0);
  });
});
