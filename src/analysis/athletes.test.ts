import { describe, expect, it } from 'vitest';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { keepAthletes, trackTravel } from './athletes';
import type { PoseTrack } from './types';

const kp = [{ x: 0, y: 0, visibility: 1 }];
const track = (found: number, total = 10): PoseTrack =>
  ({
    frames: Array.from({ length: total }, (_, i) => (i < found ? kp : null)),
    times: [],
    height: 100,
  }) as unknown as PoseTrack;

/** A track of 8 seconds at 30 fps in a picture 1000 pixels high, the hips `hipY(t)` pixels down. */
function moving(hipY: (t: number) => number, total = 240): PoseTrack {
  const times = Array.from({ length: total }, (_, i) => i / 30);
  const frames = times.map((t) => {
    const landmarks: Keypoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 500, y: hipY(t), visibility: 1 }));
    landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x: 500, y: hipY(t), visibility: 1 };
    return landmarks;
  });
  return { width: 1000, height: 1000, fps: 30, sourceFps: 30, times, frames, backend: 'test' } as PoseTrack;
}

const jump = (t: number) => 600 - 350 * Math.abs(Math.sin((Math.PI * t) / 1.6));

describe('trackTravel', () => {
  it('measures the height of the jumps for a jumper, as a share of the picture', () => {
    expect(trackTravel(moving(jump))).toBeGreaterThan(0.25);
  });

  it('is nearly nothing for a spotter who only raises their arms (the hips stay)', () => {
    expect(trackTravel(moving((t) => 800 + 10 * Math.sin(t * 4)))).toBeLessThan(0.03);
  });
});

describe('keepAthletes', () => {
  it('puts the jumper first, however big the spotter: the travel of the hips decides the order', () => {
    const spotter = moving((t) => 800 + 10 * Math.sin(t * 4));
    const jumper = moving(jump);
    expect(keepAthletes([spotter, jumper], () => 3)).toEqual([jumper]);
  });

  it('keeps both jumpers of a synchro, the one who flies higher first', () => {
    const low = moving((t) => 600 - 250 * Math.abs(Math.sin((Math.PI * (t + 0.3)) / 1.6)));
    const high = moving(jump);
    expect(keepAthletes([low, high], () => 3)).toEqual([high, low]);
  });

  it('keeps the people who jump, in order, and drops those who do not', () => {
    const [a, coach, b] = [track(10), track(10), track(10)];
    const jumps = new Map([
      [a, 5],
      [coach, 0],
      [b, 4],
    ]);
    expect(keepAthletes([a, coach, b], (t) => jumps.get(t) ?? 0)).toEqual([a, b]);
  });

  it('drops somebody who was found in a few frames only', () => {
    const [a, passer] = [track(10), track(1)];
    expect(keepAthletes([a, passer], () => 3)).toEqual([a]);
  });

  it('keeps the track with the most poses when nobody jumps', () => {
    const [a, b] = [track(3), track(8)];
    expect(keepAthletes([a, b], () => 0)).toEqual([b]);
  });
});
