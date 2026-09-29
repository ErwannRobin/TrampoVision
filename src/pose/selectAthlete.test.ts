import { describe, expect, it } from 'vitest';
import { LM } from './landmarks';
import { AthleteTracker } from './selectAthlete';
import type { Keypoint } from './types';

/** A 33-point person whose shoulders and hips (all the tracker reads) sit `torso` pixels apart, hips at (x, y). */
function person(x: number, y: number, torso = 100): Keypoint[] {
  const kp: Keypoint[] = Array.from({ length: 33 }, () => ({ x, y, visibility: 1 }));
  kp[0] = { x: x + torso / 2, y: y - torso * 1.3, visibility: 1 };
  for (const i of [LM.L_HIP, LM.R_HIP]) kp[i] = { x, y, visibility: 1 };
  for (const i of [LM.L_SHOULDER, LM.R_SHOULDER]) kp[i] = { x, y: y - torso, visibility: 1 };
  return kp;
}

describe('AthleteTracker', () => {
  it('locks on the biggest person and follows them', () => {
    const t = new AthleteTracker();
    const athlete = person(500, 600, 100);
    expect(t.select([person(100, 600, 60), athlete])).toBe(athlete);
    const next = person(505, 550, 100);
    expect(t.select([person(120, 600, 60), next])).toBe(next);
  });

  it('stays on the athlete when a bigger person walks into the foreground', () => {
    const t = new AthleteTracker();
    t.select([person(500, 600, 100)]);
    const athlete = person(510, 500, 100);
    const foreground = person(700, 900, 260);
    expect(t.select([foreground, athlete])).toBe(athlete);
  });

  it('leaves the frame empty rather than switching to a stranger', () => {
    const t = new AthleteTracker();
    t.select([person(500, 600, 100)]);
    expect(t.select([person(900, 700, 300)])).toBeNull();
    expect(t.select([])).toBeNull();
  });

  it('finds the athlete again after a few lost frames', () => {
    const t = new AthleteTracker();
    t.select([person(500, 600, 100)]);
    for (let i = 0; i < 3; i++) expect(t.select([])).toBeNull();
    const back = person(560, 520, 100);
    expect(t.select([person(900, 700, 300), back])).toBe(back);
  });

  it('follows a fast jump: the prediction and the last position both count', () => {
    const t = new AthleteTracker();
    let y = 600;
    for (let i = 0; i < 6; i++) {
      y -= 60;
      t.select([person(500, y)]);
    }
    const apex = person(500, y - 20);
    expect(t.select([person(300, y, 100), apex])).toBe(apex);
  });
});
