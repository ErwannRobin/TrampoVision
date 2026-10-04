import { describe, expect, it } from 'vitest';
import { AthleteScout, SCOUT_SETTLE_S } from './scout';
import type { Box, MotionResult } from './types';

/** What the detector says about a frame: where the athletes are, and whether it found one. */
const said = (athletes: Box[], found = athletes.length > 0) => ({ found, athletes }) as unknown as MotionResult;

describe('the look ahead at the start of a clip', () => {
  it('knows nothing until an athlete is found', () => {
    const scout = new AthleteScout();
    expect(scout.push(said([]), 0)).toBe(false);
    expect(scout.push(null, 0.1)).toBe(false);
    expect(scout.box()).toBeNull();
  });

  it('puts together the boxes seen while the athlete is found, and is done a jump after it found them', () => {
    const scout = new AthleteScout();
    expect(scout.push(said([{ x0: 50, y0: 30, x1: 60, y1: 50 }]), 3)).toBe(false);
    expect(scout.push(said([{ x0: 52, y0: 10, x1: 64, y1: 28 }]), 3.5)).toBe(false);
    expect(scout.push(said([{ x0: 48, y0: 40, x1: 58, y1: 60 }]), 3 + SCOUT_SETTLE_S)).toBe(true);
    expect(scout.box()).toEqual({ x0: 48, y0: 10, x1: 64, y1: 60 });
  });

  it('does not count a frame in which the athlete is not found', () => {
    const scout = new AthleteScout();
    scout.push(said([{ x0: 50, y0: 30, x1: 60, y1: 50 }]), 3);
    scout.push(said([{ x0: 0, y0: 0, x1: 127, y1: 71 }], false), 3.2);
    expect(scout.box()).toEqual({ x0: 50, y0: 30, x1: 60, y1: 50 });
  });

  it('gives a copy: the box is not changed by what comes after', () => {
    const scout = new AthleteScout();
    scout.push(said([{ x0: 50, y0: 30, x1: 60, y1: 50 }]), 3);
    const box = scout.box()!;
    box.x0 = 0;
    expect(scout.box()!.x0).toBe(50);
  });
});
