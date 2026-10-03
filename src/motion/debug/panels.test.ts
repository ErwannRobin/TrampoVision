import { describe, expect, it } from 'vitest';
import { motionRgba } from './panels';

describe('the colors of the motion map', () => {
  it('is blue where something moves up, orange where it moves down, and clear where nothing moves', () => {
    const rgba = new Uint8ClampedArray(3 * 4);
    motionRgba(Float32Array.from([-1, 0, 1]), rgba);
    const [up, still, down] = [0, 1, 2].map((i) => Array.from(rgba.slice(i * 4, i * 4 + 4)));
    expect(up[2]).toBeGreaterThan(up[0]);
    expect(up[3]).toBe(255);
    expect(still[3]).toBe(0);
    expect(down[0]).toBeGreaterThan(down[2]);
    expect(down[3]).toBe(255);
  });

  it('is stronger where the detector is surer', () => {
    const rgba = new Uint8ClampedArray(2 * 4);
    motionRgba(Float32Array.from([-0.25, -0.75]), rgba);
    expect(rgba[7]).toBeGreaterThan(rgba[3]);
    expect(rgba[3]).toBe(64);
  });
});
