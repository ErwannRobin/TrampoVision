import { describe, expect, it } from 'vitest';
import { evaluate, formatSummary, type Condition } from './evaluation';

/**
 * Synthetic separability check. The jumps come from an articulated model with known joint angles, so a pass
 * here means "the features and rules carry enough information IF the pose estimator is this accurate", and
 * that the failure modes we could simulate end in "unclassified" instead of a confident wrong skill.
 * It does not measure how a real pose model behaves on real trampoline footage.
 */

const ROUTINES = 20; // 5 jumps each: 100 jumps per condition
const log = (s: ReturnType<typeof evaluate>) => console.log('\n' + formatSummary(s));

const base: Condition = { name: 'clean', noise: 0, dropout: 0, flip: 'none' };

describe('synthetic evaluation', () => {
  it('separates the five skills on clean input', () => {
    const s = evaluate(base, { routines: ROUTINES });
    log(s);
    expect(s.n).toBe(ROUTINES * 5);
    expect(s.missedJumps).toBe(0);
    expect(s.accuracy).toBeGreaterThanOrEqual(0.97);
    expect(s.confidentWrong).toBe(0);
  });

  it('keeps working with landmark jitter of 2% of the height and 10% dropped landmarks', () => {
    const s = evaluate({ ...base, name: 'jitter 2% + dropout 10%', noise: 0.02, dropout: 0.1 }, { routines: ROUTINES });
    log(s);
    expect(s.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(s.confidentWrong).toBe(0);
  });

  it('abstains, instead of guessing, when the positions overlap (loose tucks, bent-knee pikes, piked layouts)', () => {
    const s = evaluate(
      { ...base, name: 'sloppy execution, jitter 1%', noise: 0.01 },
      { routines: ROUTINES, execution: 'sloppy' },
    );
    log(s);
    expect(s.accuracyWhenAnswered).toBeGreaterThanOrEqual(0.95);
    expect(s.confidentWrong).toBe(0);
  });

  it('never gives a confident wrong skill when the pose model mirrors inverted athletes', () => {
    const s = evaluate(
      { ...base, name: 'pose flip (mirror), jitter 1%', noise: 0.01, flip: 'mirror' },
      { routines: ROUTINES },
    );
    log(s);
    expect(s.confidentWrong).toBe(0);
    // Jumps that never invert are unaffected.
    for (const t of ['straight-jump', 'tuck-jump', 'pike-jump'] as const)
      expect(s.matrix[t][t] ?? 0).toBeGreaterThanOrEqual(ROUTINES * 0.95);
    // A mirrored body is not one turned over, so nothing puts it right: the somersaults are not named firmly (unclassified or a
    // tentative guess). The limit is shown, not hidden.
    const somersaults = s.rows.filter((r) => r.truth === 'back' || r.truth === 'front');
    expect(
      somersaults.filter((r) => r.predicted === 'unclassified' || r.certainty === 'tentative').length,
    ).toBeGreaterThanOrEqual(ROUTINES * 2 * 0.9);
  });

  it('names the somersaults of an athlete the model turned over, once the frames are turned back', () => {
    const turned: Condition = { ...base, name: 'pose flip (rotate180), jitter 1%', noise: 0.01, flip: 'rotate180' };
    const repaired = evaluate(turned, { routines: ROUTINES });
    const orientationOnly = evaluate(turned, { routines: ROUTINES, analysis: { repairFrames: false } });
    const plain = evaluate(turned, { routines: ROUTINES, analysis: { repairOrientation: false } });
    log(repaired);
    expect(repaired.confidentWrong).toBe(0);
    expect(repaired.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(plain.accuracy).toBeLessThan(0.7);
    for (const t of ['straight-jump', 'tuck-jump', 'pike-jump'] as const)
      expect(repaired.matrix[t][t] ?? 0).toBeGreaterThanOrEqual(ROUTINES * 0.95);
    // With the frames turned back the center of mass and the joint angles are the athlete's again: the somersaults are named firmly.
    const firm = (s: typeof repaired) =>
      s.rows.filter((r) => (r.truth === 'back' || r.truth === 'front') && r.correct && r.certainty !== 'tentative')
        .length;
    expect(firm(repaired)).toBeGreaterThanOrEqual(ROUTINES * 2 * 0.9);
    // With only the orientation put back, as before, they were right too but never firmly: the turned-over frames still bent the
    // center of mass and the joint angles.
    expect(orientationOnly.confidentWrong).toBe(0);
    expect(orientationOnly.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(firm(orientationOnly)).toBeLessThanOrEqual(ROUTINES * 2 * 0.1);
  });

  it('does not name a somersault seen from far off side-on (yaw 70°)', () => {
    const s = evaluate(
      { ...base, name: 'camera yaw 70°, jitter 1%', noise: 0.01, yawDeg: 70 },
      { routines: ROUTINES, config: { forceGuess: false } },
    );
    log(s);
    expect(s.confidentWrong).toBe(0);
    expect((s.matrix.back.back ?? 0) + (s.matrix.front.front ?? 0)).toBeLessThan(ROUTINES * 2 * 0.2);
  });
});

/** The app asks the classifier to guess. A guess must stay honest: named every time, and never a confident wrong one. */
describe('synthetic evaluation with forced guesses', () => {
  const hard: Condition[] = [
    { ...base, name: 'pose flip (mirror), jitter 1%', noise: 0.01, flip: 'mirror' },
    { ...base, name: 'camera yaw 70°, jitter 1%', noise: 0.01, yawDeg: 70 },
    { ...base, name: 'jitter 4% + dropout 10%', noise: 0.04, dropout: 0.1 },
  ];
  it.each(hard)('names every jump and is never confidently wrong: %o', (condition) => {
    const s = evaluate(condition, { routines: ROUTINES });
    log(s);
    expect(s.rows.every((r) => r.predicted !== 'unclassified' && r.predicted !== 'somersault-direction-unknown')).toBe(
      true,
    );
    expect(s.confidentWrong).toBe(0);
    // Whatever it says without being sure is flagged as a tentative guess: the wrong answers are the unsure ones.
    const wrong = s.rows.filter((r) => !r.correct);
    expect(wrong.every((r) => r.certainty === 'tentative' || r.confidence < 0.6)).toBe(true);
  });

  it('gets the easy conditions as right as before', () => {
    const declined = evaluate(base, { routines: ROUTINES, config: { forceGuess: false } });
    const guessed = evaluate(base, { routines: ROUTINES });
    expect(guessed.accuracy).toBeGreaterThanOrEqual(declined.accuracy);
  });
});
