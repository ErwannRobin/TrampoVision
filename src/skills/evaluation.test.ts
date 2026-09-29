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

  it.each(['mirror', 'rotate180'] as const)(
    'never gives a confident wrong skill when the pose model flips inverted athletes (%s)',
    (flip) => {
      const s = evaluate(
        { ...base, name: `pose flip (${flip}), jitter 1%`, noise: 0.01, flip },
        { routines: ROUTINES },
      );
      log(s);
      expect(s.confidentWrong).toBe(0);
      // Jumps that never invert are unaffected.
      for (const t of ['straight-jump', 'tuck-jump', 'pike-jump'] as const)
        expect(s.matrix[t][t] ?? 0).toBeGreaterThanOrEqual(ROUTINES * 0.95);
      // The somersaults are reported as unclassified: the limit is shown, not hidden.
      expect((s.matrix.back.unclassified ?? 0) + (s.matrix.front.unclassified ?? 0)).toBeGreaterThanOrEqual(
        ROUTINES * 2 * 0.9,
      );
    },
  );

  it('does not name a somersault seen from far off side-on (yaw 70°)', () => {
    const s = evaluate({ ...base, name: 'camera yaw 70°, jitter 1%', noise: 0.01, yawDeg: 70 }, { routines: ROUTINES });
    log(s);
    expect(s.confidentWrong).toBe(0);
    expect((s.matrix.back.back ?? 0) + (s.matrix.front.front ?? 0)).toBeLessThan(ROUTINES * 2 * 0.2);
  });
});
