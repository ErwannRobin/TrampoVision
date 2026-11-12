import { describe, expect, it } from 'vitest';
import {
  CLEAN,
  COMPETITION_SKILLS,
  HARD,
  MILD,
  evaluateCompetition,
  formatBySomersaults,
  formatCompetition,
  formatPose,
  spinProfile,
} from './competitionEval';

/**
 * The skills of a competition routine (double and triple somersaults, 1.4 to 1.9 s in the air) through a pose model that fails the
 * way one does on a fast athlete. A pass means "with a model that fails like this simulated one, the analysis still counts the
 * somersaults and names the skill". How a real model fails on real footage is an assumption of `competitionEval.ts`, not a
 * measurement: see the README, _Fast skills_.
 */

const ROUTINES = 14; // 5 jumps each: 70 jumps per condition
const log = (s: ReturnType<typeof evaluateCompetition>) =>
  console.log(`\n${formatCompetition(s)}\n  ${formatBySomersaults(s)}\n  ${formatPose(s)}`);

describe('the skills drawn', () => {
  it('are one to three somersaults, front and back, in the positions a person does them in', () => {
    expect(COMPETITION_SKILLS).toHaveLength(16);
    expect(COMPETITION_SKILLS.some((s) => s.somersaults === 3 && s.position === 'straight')).toBe(false);
  });

  it('turn faster while the body is folded, and never back', () => {
    const tuck = spinProfile(3, 0.25, 0.75);
    expect(tuck(0)).toBe(0);
    expect(tuck(1)).toBeCloseTo(1, 9);
    let last = 0;
    for (let u = 0.01; u <= 1; u += 0.01) {
      expect(tuck(u)).toBeGreaterThan(last);
      last = tuck(u);
    }
    // The middle of the flight, folded, turns about three times as fast as its start.
    expect((tuck(0.55) - tuck(0.45)) / (tuck(0.1) - tuck(0))).toBeGreaterThan(2.5);
    // A stretched body turns steadily.
    expect(spinProfile(1, 0.25, 0.75)(0.3)).toBeCloseTo(0.3, 6);
  });
});

describe('competition skills through a pose model that fails on a fast athlete', () => {
  it('names every skill of a clean track', () => {
    const s = evaluateCompetition(CLEAN, { routines: ROUTINES });
    log(s);
    expect(s.n).toBe(ROUTINES * 5);
    expect(s.found).toBe(s.n);
    expect(s.element).toBe(s.n);
    expect(s.turnsError).toBeLessThan(0.05);
  });

  it.each([30, 25])('holds with a little blur and a few frames lost, at %i frames a second', (fps) => {
    const s = evaluateCompetition(MILD, { routines: ROUTINES, fps });
    log(s);
    expect(s.found).toBe(s.n);
    expect(s.element).toBeGreaterThanOrEqual(0.97 * s.n);
    expect(s.firmWrong).toBe(0);
  });

  it.each([30, 25])(
    'still counts the somersaults when a third of the upside-down frames are lost, at %i frames a second',
    (fps) => {
      const s = evaluateCompetition(HARD, { routines: ROUTINES, fps });
      log(s);
      // The simulated model does fail: a test that loses nothing shows nothing.
      expect(s.failed.lost / s.failed.inverted).toBeGreaterThan(0.25);
      expect(s.failed.flipped / s.failed.inverted).toBeGreaterThan(0.05);
      expect(s.found).toBeGreaterThanOrEqual(0.98 * s.n);
      expect(s.somersaults).toBeGreaterThanOrEqual(0.93 * s.n);
      expect(s.element).toBeGreaterThanOrEqual(0.9 * s.n);
      expect(s.firmWrong).toBe(0);
      // The athlete is where the analysis says, also in the frames the model failed on.
      expect(s.pose.comCoverage).toBeGreaterThan(0.99);
      expect(s.pose.failedJoint).toBeLessThan(0.12);
    },
  );

  it('owes that to reading the flight as a flight: without the repairs the same track loses one skill in five', () => {
    // The orientation taken as the model gives it, the frames left as they are: what the analysis did with a head/feet flip before
    // any repair. (The parabola through a lost apex and the bridge in the body frame are still on: they have no switch.)
    const plain = evaluateCompetition(HARD, { routines: ROUTINES, analysis: { repairOrientation: false } });
    const repaired = evaluateCompetition(HARD, { routines: ROUTINES });
    log(plain);
    expect(repaired.element - plain.element).toBeGreaterThanOrEqual(0.1 * plain.n);
    expect(repaired.pose.failedJoint).toBeLessThan(plain.pose.failedJoint);
  });
});
