import { describe, expect, it } from 'vitest';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import { bodyCenter, focusOnAthletes } from './focus';

const picture = { width: 128, height: 72 };

/** A person whose hips are at (x, y) of the picture (0 to 1), and whose other points are around them. */
function person(x: number, y: number, visibility = 1): PoseDetection {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: y - 0.1, visibility }));
  landmarks[LM.L_HIP] = { x: x - 0.01, y, visibility };
  landmarks[LM.R_HIP] = { x: x + 0.01, y, visibility };
  return { landmarks };
}

/** A box around (x, y) of the picture, in the pixels of the detector. */
const boxAt = (x: number, y: number, halfW = 8, halfH = 12) => ({
  x0: Math.round(x * picture.width) - halfW,
  x1: Math.round(x * picture.width) + halfW,
  y0: Math.round(y * picture.height) - halfH,
  y1: Math.round(y * picture.height) + halfH,
});

describe('the middle of a body', () => {
  it('is the middle of the hips', () => {
    const c = bodyCenter(person(0.4, 0.6));
    expect(c.x).toBeCloseTo(0.4);
    expect(c.y).toBeCloseTo(0.6);
  });

  it('is the mean of the points that are seen when the hips are not', () => {
    const p = person(0.4, 0.6);
    p.landmarks[LM.L_HIP].visibility = p.landmarks[LM.R_HIP].visibility = 0;
    p.landmarks[LM.L_SHOULDER] = { x: 0.3, y: 0.4, visibility: 1 };
    p.landmarks.forEach((l, i) => {
      if (i !== LM.L_SHOULDER) l.visibility = 0;
    });
    expect(bodyCenter(p)).toEqual({ x: 0.3, y: 0.4 });
  });
});

describe('the person who jumps, among the people the pose model found', () => {
  const athlete = person(0.5, 0.6);
  const coach = person(0.8, 0.8);

  it('keeps the person in the box of the athlete, and drops the person who stands elsewhere', () => {
    expect(focusOnAthletes([coach, athlete], [boxAt(0.5, 0.55)], picture)).toEqual([athlete]);
  });

  it('is not led astray by a person who stands closer to the picture than the athlete does: the box decides', () => {
    const near = person(0.5, 0.6);
    const standing = person(0.6, 0.62);
    expect(focusOnAthletes([standing, near], [boxAt(0.5, 0.6, 6, 12)], picture)).toEqual([near]);
  });

  it('leaves nobody when the model lost the athlete and only found somebody else', () => {
    expect(focusOnAthletes([coach], [boxAt(0.5, 0.55)], picture)).toEqual([]);
  });

  it('gives everybody back when the detector does not know where the athlete is yet', () => {
    expect(focusOnAthletes([coach, athlete], [], picture)).toEqual([coach, athlete]);
  });

  it('keeps one person for each athlete, and never the same person twice', () => {
    const left = person(0.3, 0.6);
    const right = person(0.7, 0.6);
    expect(focusOnAthletes([right, left, coach], [boxAt(0.3, 0.55), boxAt(0.7, 0.55)], picture)).toEqual([right, left]);
    // Two boxes that both have one person in them: they are not both given to it.
    expect(focusOnAthletes([athlete], [boxAt(0.5, 0.55), boxAt(0.51, 0.56)], picture)).toEqual([athlete]);
  });

  it('allows for a box that is a frame behind a fast jump', () => {
    // The hips are a quarter of the box's height above its middle... and a little outside the box.
    const high = person(0.5, 0.45);
    expect(focusOnAthletes([high], [boxAt(0.5, 0.6, 6, 8)], picture)).toEqual([high]);
    // A person much farther away than that is somebody else.
    expect(focusOnAthletes([person(0.5, 0.2)], [boxAt(0.5, 0.6, 6, 8)], picture)).toEqual([]);
  });
});
