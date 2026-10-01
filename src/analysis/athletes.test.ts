import { describe, expect, it } from 'vitest';
import { keepAthletes } from './athletes';
import type { PoseTrack } from './types';

const kp = [{ x: 0, y: 0, visibility: 1 }];
const track = (found: number, total = 10): PoseTrack =>
  ({ frames: Array.from({ length: total }, (_, i) => (i < found ? kp : null)) }) as unknown as PoseTrack;

describe('keepAthletes', () => {
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
