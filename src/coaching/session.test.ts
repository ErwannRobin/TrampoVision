import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import { callOf } from './guess';
import { buildSession, labelOf, type JumpLabel } from './session';

/** A short set: a bounce, a tuck jump, a back tuck, the same back tuck again, a front pike. */
const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'straight' },
    { v0: 4.4, shape: 'tuck' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.8, turns: 1, shape: 'pike' },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const session = (labels?: (JumpLabel | null)[]) => buildSession({ skills, result, twist: null, labels });

describe('a set of skills', () => {
  const s = session();

  it('says why a forced guess is weak, and nothing for a name that is firm', () => {
    expect(s.jumps[2].why).toBeNull();
    expect(s.jumps.every((j) => j.why === null || j.forced)).toBe(true);
  });

  it('names every jump and keeps the bounces out of the skills', () => {
    expect(s.jumps).toHaveLength(5);
    expect(s.jumps.map((j) => j.element?.name)).toEqual([
      'Straight jump',
      'Tuck jump',
      'Back somersault (tuck)',
      'Back somersault (tuck)',
      'Front somersault (pike)',
    ]);
    expect(s.jumps.map((j) => j.isSkill)).toEqual([false, true, true, true, true]);
    expect(s.summary.skills).toBe(4);
    expect(s.summary.bounces).toBe(1);
  });

  it('adds the difficulty of the skills and counts a repetition once', () => {
    expect(s.jumps.map((j) => j.counted)).toEqual([0, 0.1, 0.5, 0, 0.6]);
    expect(s.jumps.map((j) => j.repeated)).toEqual([false, false, false, true, false]);
    expect(s.summary.difficulty).toBe(1.2);
  });

  it('proposes an execution for every skill, and scores ten skills like these', () => {
    for (const j of s.jumps.filter((x) => x.isSkill)) {
      expect(j.execution?.checked).toBe(true);
      expect(j.deduction).toBe(j.proposed);
    }
    expect(s.jumps[0].execution).toBeNull();
    expect(s.summary.judged).toBe(4);
    const mean = s.jumps.filter((j) => j.isSkill).reduce((sum, j) => sum + (j.deduction ?? 0), 0) / 4;
    expect(s.summary.execution).toBeCloseTo(10 - 10 * mean, 1);
    expect(s.summary.execution!).toBeLessThanOrEqual(10);
  });

  it('adds up the time in the air of the skills only', () => {
    const flights = s.jumps.filter((j) => j.isSkill).map((j) => j.flightS!);
    expect(s.summary.flightS).toBeCloseTo(
      flights.reduce((a, b) => a + b, 0),
      1,
    );
  });
});

describe('what a person says', () => {
  it('replaces the guess with the element they name, and the difficulty follows', () => {
    const s = session([null, null, { elementId: 'back-1s-0t-pike', other: false, deduction: null }]);
    const j = s.jumps[2];
    expect(j.source).toBe('coach');
    expect(j.element?.name).toBe('Back somersault (pike)');
    expect(j.difficulty?.value).toBe(0.6);
    expect(j.certainty).toBe('confident');
    // The next back tuck is no longer a repetition: 0.1 + 0.6 + 0.5 + 0.6.
    expect(s.jumps[3].repeated).toBe(false);
    expect(s.summary.difficulty).toBe(1.8);
    // The deductions are those of the element that was named: a pike is judged on its legs and its opening.
    expect(j.execution?.checked).toBe(true);
  });

  it('says when the body was easier than the position they named, and what a judge would score', () => {
    const named = session([null, null, { elementId: 'back-1s-0t-pike', other: false, deduction: null }]).jumps[2];
    expect(named.easier).toMatchObject({ measured: 'tuck' });
    expect(named.easier?.element.id).toBe('back-1s-0t-tuck');
    expect(named.easier!.element.difficulty).toBeLessThan(named.element!.difficulty);
    // The name that matches the body has nothing to say, and neither has a pose that was harder than the name.
    expect(session().jumps[2].easier).toBeNull();
    const easy = session([null, null, { elementId: 'back-1s-0t-tuck', other: false, deduction: null }]);
    expect(easy.jumps[2].easier).toBeNull();
  });

  it('keeps the other candidates to offer, without the one that is chosen', () => {
    const j = session([null, null, { elementId: 'back-1s-0t-pike', other: false, deduction: null }]).jumps[2];
    expect(j.alternatives.length).toBeGreaterThan(0);
    expect(j.alternatives.map((a) => a.elementId)).not.toContain('back-1s-0t-pike');
    expect(j.alternatives.every((a) => typeof a.difficulty === 'number')).toBe(true);
  });

  it('takes the deduction they give instead of the proposal, and keeps the proposal', () => {
    const s = session([null, null, { elementId: null, other: false, deduction: 0.4 }]);
    const j = s.jumps[2];
    expect(j.deduction).toBe(0.4);
    expect(j.coachDeduction).toBe(0.4);
    expect(j.proposed).not.toBeNull();
    expect(j.source).toBe('auto');
  });

  it('leaves a jump out of the totals when they say it is none of the elements', () => {
    const s = session([null, null, { elementId: null, other: true, deduction: null }]);
    expect(s.jumps[2].element).toBeNull();
    expect(s.jumps[2].other).toBe(true);
    expect(s.summary.skills).toBe(3);
    // The back tuck that is left is now the first one, so it counts: 0.1 + 0.5 + 0.6.
    expect(s.jumps[3].repeated).toBe(false);
    expect(s.summary.difficulty).toBe(1.2);
  });

  it('reads the label out of a saved record', () => {
    const rec = (over: object) => ({ figure: null, truth: null, execution: null, ...over }) as never;
    expect(labelOf(null)).toBeNull();
    expect(labelOf(rec({}))).toBeNull();
    expect(labelOf(rec({ figure: { elementId: 'back-1s-0t-tuck', labeledAt: '' } }))).toEqual({
      elementId: 'back-1s-0t-tuck',
      other: false,
      deduction: null,
    });
    expect(labelOf(rec({ truth: { label: 'unknown' } }))).toEqual({ elementId: null, other: true, deduction: null });
    expect(labelOf(rec({ execution: { deduction: 0.2 } }))?.deduction).toBe(0.2);
  });
});

describe('what to work on', () => {
  it('gives the tips of the skills, and the focus of the set from them', () => {
    const s = session();
    const cost = s.jumps.flatMap((j) => j.tips).filter((t) => t.gain > 0);
    expect(s.summary.focus.length).toBeLessThanOrEqual(2);
    for (const f of s.summary.focus) expect(cost.length === 0 || f.gain >= 0).toBe(true);
    expect(s.tips.length).toBe(s.jumps.reduce((n, j) => n + j.tips.length, 0));
  });

  it('warns when the camera is not side-on', () => {
    expect(session().summary.warnings).toEqual([]);
  });
});

describe('a guess the classifier would not name', () => {
  const { track: shaky } = mannequinRoutine({
    jumps: [
      { v0: 4.4, shape: 'tuck' },
      { v0: 4.8, turns: -1, shape: 'tuck' },
      { v0: 4.6, turns: 1.25, shape: 'straight' },
    ],
    facing: 1,
  });
  const shakyResult = computeAnalysis(shaky, { athleteHeightM: 1.75 });
  const shakySkills = analyzeSkills(shakyResult);
  const shakySession = (labels?: (JumpLabel | null)[]) =>
    buildSession({ skills: shakySkills, result: shakyResult, twist: null, labels });

  it('waits for a check and stays out of the totals', () => {
    const s = shakySession();
    expect(s.jumps[2].forced).toBe(true);
    expect(s.jumps[2].pending).toBe(true);
    expect(s.jumps[2].isSkill).toBe(true);
    expect(s.summary.skills).toBe(2);
    expect(s.summary.pending).toBe(1);
    expect(s.summary.difficulty).toBe(0.6); // the tuck jump and the back tuck: 0.1 + 0.5
    expect(s.jumps[2].counted).toBe(0);
    expect(s.tips.every((t) => t.jump !== 2)).toBe(true);
  });

  it('counts once the person says what it was, or that the guess is right', () => {
    const said = shakySession([
      null,
      null,
      { elementId: shakySession().jumps[2].element!.id, other: false, deduction: null },
    ]);
    expect(said.jumps[2].pending).toBe(false);
    expect(said.summary.pending).toBe(0);
    expect(said.summary.skills).toBe(3);
    expect(said.summary.difficulty).toBeGreaterThan(0.6);
  });

  it('is not pending for a name the classifier stands behind', () => {
    expect(shakySession().jumps[1].pending).toBe(false);
  });

  it('offers a jump without rotation first when the pose could not be trusted', () => {
    const j = shakySession().jumps[2];
    const p = { ...shakySkills.jumps[2].prediction, dataQuality: 0.05 };
    const call = callOf(p)!;
    expect(call.alternatives[0].elementId).toBe(`none-0s-0t-${call.element.position}`);
    expect(callOf({ ...p, dataQuality: 0.9 })!.alternatives[0]?.elementId).not.toBe(
      `none-0s-0t-${call.element.position}`,
    );
    expect(j.alternatives.length).toBeGreaterThan(0);
  });
});
