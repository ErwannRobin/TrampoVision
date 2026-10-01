import { describe, expect, it } from 'vitest';
import { bodySignature, signatureDistance, type Pixels } from './appearance';
import { LM } from './landmarks';
import type { Keypoint } from './types';

/** A 200 x 200 picture: red shirt (upper half of the body), blue shorts (lower half). */
function picture(shirt: [number, number, number], shorts: [number, number, number]): Pixels {
  const width = 200;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = y < 100 ? shirt : shorts;
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height, scale: 1 };
}

/** Shoulders at y = 40..60, hips at y = 110, knees at y = 170: the shirt is above the hips, the thighs are shorts. */
function person(): Keypoint[] {
  const kp: Keypoint[] = Array.from({ length: 33 }, () => ({ x: 100, y: 100, visibility: 1 }));
  kp[LM.L_SHOULDER] = { x: 80, y: 40, visibility: 1 };
  kp[LM.R_SHOULDER] = { x: 120, y: 40, visibility: 1 };
  kp[LM.L_HIP] = { x: 85, y: 105, visibility: 1 };
  kp[LM.R_HIP] = { x: 115, y: 105, visibility: 1 };
  kp[LM.L_KNEE] = { x: 85, y: 170, visibility: 1 };
  kp[LM.R_KNEE] = { x: 115, y: 170, visibility: 1 };
  return kp;
}

describe('bodySignature', () => {
  it('reads the color of the shirt and of the legs', () => {
    const sig = bodySignature(picture([255, 0, 0], [0, 0, 255]), person());
    expect(sig?.torso?.[0]).toBeGreaterThan(0.9);
    expect(sig?.legs?.[2]).toBeGreaterThan(0.9);
  });

  it('tells two outfits apart and recognises the same one', () => {
    const red = bodySignature(picture([255, 0, 0], [0, 0, 255]), person())!;
    const again = bodySignature(picture([250, 5, 5], [5, 5, 250]), person())!;
    const other = bodySignature(picture([20, 200, 20], [240, 240, 240]), person())!;
    expect(signatureDistance(red, again)!).toBeLessThan(0.05);
    expect(signatureDistance(red, other)!).toBeGreaterThan(0.4);
  });

  it('has nothing to say about a person outside the picture', () => {
    const away = person().map((p) => ({ ...p, x: p.x + 1000 }));
    expect(bodySignature(picture([255, 0, 0], [0, 0, 255]), away)).toBeNull();
  });
});
