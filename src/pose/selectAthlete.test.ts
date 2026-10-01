import { describe, expect, it } from 'vitest';
import type { Signature } from './appearance';
import { LM } from './landmarks';
import { AthleteTracker, MultiAthleteTracker } from './selectAthlete';
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

describe('MultiAthleteTracker', () => {
  it('gives the tracks to the two biggest people, the leftmost first, and ignores the others', () => {
    const t = new MultiAthleteTracker(2);
    const left = person(300, 600, 100);
    const right = person(800, 600, 100);
    const [a, b] = t.select([person(500, 600, 40), right, left]);
    expect(a).toBe(left);
    expect(b).toBe(right);
  });

  it('keeps each athlete on their own track frame after frame', () => {
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600), person(800, 600)]);
    const left = person(305, 560);
    const right = person(795, 540);
    // The detector lists them in the opposite order: the tracks follow the people, not the order.
    const [a, b] = t.select([right, left]);
    expect(a).toBe(left);
    expect(b).toBe(right);
  });

  it('does not swap two athletes who pass close to each other', () => {
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600), person(500, 450)]);
    let x1 = 300;
    let x2 = 500;
    for (let i = 0; i < 8; i++) {
      x1 += 30;
      x2 -= 30;
      const first = person(x1, 600);
      // One athlete is higher in the picture, so their bodies cross without sitting on the same spot.
      const second = person(x2, 450);
      const [a, b] = t.select([first, second]);
      if (i < 5) {
        expect(a).toBe(first);
        expect(b).toBe(second);
      }
    }
  });

  it('leaves one athlete empty while the other is still followed', () => {
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600), person(800, 600)]);
    const right = person(805, 590);
    const [a, b] = t.select([right]);
    expect(a).toBeNull();
    expect(b).toBe(right);
  });

  it('never gives one detection to two athletes', () => {
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600), person(340, 600)]);
    const only = person(320, 600);
    const out = t.select([only]);
    expect(out.filter((p) => p === only)).toHaveLength(1);
  });

  it('picks up the second athlete when they enter later', () => {
    const t = new MultiAthleteTracker(2);
    const first = person(300, 600);
    expect(t.select([first])).toEqual([first, null]);
    const second = person(800, 600);
    const out = t.select([person(302, 600), second]);
    expect(out[1]).toBe(second);
  });

  it('behaves like the single tracker with one athlete', () => {
    const t = new MultiAthleteTracker(1);
    t.select([person(500, 600, 100)]);
    const athlete = person(510, 500, 100);
    expect(t.select([person(700, 900, 260), athlete])).toEqual([athlete]);
    expect(t.select([person(900, 700, 300)])).toEqual([null]);
  });

  it('does not turn the second detection of the same person into another athlete', () => {
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600, 100), person(800, 600, 100)]);
    // The right athlete is lost for a while: the gate of their track opens wide.
    for (let i = 0; i < 4; i++) t.select([person(300, 600, 100)]);
    const left = person(305, 590, 100);
    const ghost = person(310, 585, 50); // a smaller pose inside the left athlete's box
    const [a, b] = t.select([left, ghost]);
    expect(a).toBe(left);
    expect(b).toBeNull();
  });

  it('keeps the athletes apart by the colors they wear when they come back from a long loss', () => {
    const look = (r: number, g: number, bl: number): Signature => ({ torso: [r, g, bl], legs: null });
    const red = look(0.9, 0.1, 0.1);
    const blue = look(0.1, 0.1, 0.9);
    const t = new MultiAthleteTracker(2);
    t.select([person(300, 600), person(500, 600)], [red, blue]);
    for (let i = 0; i < 12; i++) t.select([]);
    // They crossed while out of sight: the red athlete is now on the right.
    const right = person(480, 600);
    const left = person(320, 600);
    const [a, b] = t.select([left, right], [blue, red]);
    expect(a).toBe(right);
    expect(b).toBe(left);
  });
});
