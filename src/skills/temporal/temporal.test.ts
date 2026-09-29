import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../analysis/computeAnalysis';
import { analyzeSkills } from '../analyzeSkills';
import { DEFAULT_SKILL_CONFIG } from '../config';
import { evaluate, formatSummary, type Condition } from '../evaluation';
import { FIG_ELEMENTS, elementById } from '../fig/elements';
import { hierarchicalClassifier } from '../hierarchical';
import { mannequinRoutine, type MannequinJump } from '../testMannequin';
import { temporalClassifier } from './classifier';
import { dtw } from './dtw';
import { modelReferences, modelSignature } from './prototypes';
import { buildSignature } from './signature';

const cfg = DEFAULT_SKILL_CONFIG;
const opts = {
  bandFraction: cfg.temporal.bandFraction,
  warpPenalty: cfg.temporal.warpPenalty,
  endSigma: cfg.temporal.endSigma,
  endWeight: cfg.temporal.endWeight,
  sigma: cfg.temporal.sigma,
  weights: cfg.temporal.weights,
};

const run = (jump: MannequinJump) => {
  const { track } = mannequinRoutine({ jumps: [jump], facing: 1 });
  return analyzeSkills(computeAnalysis(track, { athleteHeightM: 1.75 })).jumps[0];
};

describe('dynamic time warping', () => {
  const back = elementById('back-1s-0t-tuck')!;
  const a = modelSignature(back, 32);

  it('is zero between a signature and itself', () => {
    expect(dtw(a, a, opts).distance).toBeCloseTo(0, 6);
  });

  it('tolerates a tuck that comes a little earlier or later, but not a different number of somersaults', () => {
    const shifted = modelSignature(back, 32);
    shifted.channels.hip = [
      ...shifted.channels.hip.slice(2),
      shifted.channels.hip.at(-1)!,
      shifted.channels.hip.at(-1)!,
    ];
    const aligned = dtw(a, shifted, opts).distance;
    const double = dtw(a, modelSignature(elementById('back-2s-0t-tuck')!, 32), opts).distance;
    expect(aligned).toBeLessThan(0.7);
    expect(double).toBeGreaterThan(aligned * 3);
  });

  it('tells a full twist from a half twist and from none', () => {
    const t = (h: number) => modelSignature(elementById(`back-1s-${h}t-straight`)!, 32);
    expect(dtw(t(1), t(1), opts).distance).toBeLessThan(dtw(t(1), t(0.5), opts).distance);
    expect(dtw(t(1), t(0.5), opts).distance).toBeGreaterThan(1.5);
    expect(dtw(t(1), t(0), opts).distance).toBeGreaterThan(3);
  });
});

describe('references', () => {
  it('has a model for every element of the table', () => {
    expect(modelReferences(32)).toHaveLength(FIG_ELEMENTS.length);
  });
});

describe('movement signature', () => {
  it('reads the rotation of a back somersault as turns in the direction it went, and the direction separately', () => {
    const j = run({ v0: 4.8, turns: -1, facing: 1, shape: 'tuck' });
    const sig = buildSignature(j.sequence, null)!;
    expect(sig.channels.somersault.at(-1)!).toBeGreaterThan(0.9);
    expect(sig.channels.somersault.at(-1)!).toBeLessThan(1.1);
    expect(sig.trust.twist).toBe(0);
    const p = j.prediction;
    expect(p.measured?.somersaults).toBeGreaterThan(0.9);
    expect(p.measured?.direction).toBe('back');
    expect(p.measured?.trajectories.hip).toHaveLength(32);
  });
});

describe('temporal classification', () => {
  it('returns the movement, the element, five candidates with similarity, and the trajectory comparison', () => {
    const p = run({ v0: 4.8, turns: -1, facing: 1, shape: 'tuck' }).prediction;
    expect(p.classifier.id).toBe('temporal');
    expect(p.skill).toBe('back');
    expect(p.certainty).toBe('confident');
    expect(p.movement).toEqual({ direction: 'back', somersaults: 1, twists: 0, position: 'tuck' });
    expect(p.candidates).toHaveLength(5);
    for (const c of p.candidates!) expect(c.similarity).toBeGreaterThanOrEqual(0);
    expect(p.comparison?.elementId).toBe(p.elementId);
    expect(p.comparison?.channels.map((c) => c.channel)).toContain('hip');
    expect(p.comparison!.channels[0].reference).toHaveLength(32);
  });

  it('a labelled example of the same element is used, and is preferred when it matches better', () => {
    const j = run({ v0: 4.8, turns: -1, facing: 1, shape: 'tuck' });
    const example = {
      id: 'example:x:1',
      elementId: 'back-1s-0t-tuck',
      kind: 'example' as const,
      signature: buildSignature(j.sequence, null)!,
    };
    const p = temporalClassifier.classify({
      cycle: j.cycle,
      features: j.features,
      sequence: j.sequence,
      config: cfg,
      references: [example],
    });
    expect(p.comparison?.referenceKind).toBe('example');
    expect(p.comparison?.similarity).toBeGreaterThan(0.99);
  });

  it('names a jump whose position is ambiguous as a tentative guess instead of hiding it', () => {
    const p = run({
      v0: 4.8,
      turns: -1,
      facing: 1,
      shape: { hipFlexDeg: 60, kneeFlexDeg: 40, armDeg: 60, elbowDeg: 0, pointedToes: 0.8 },
    }).prediction;
    expect(p.skill).not.toBe('unclassified');
    expect(p.candidates!.length).toBeGreaterThan(1);
    expect(p.certainty).toBeDefined();
  });

  it('names a somersault that lands short of the whole turn (0.82) but not a quarter turn over', () => {
    const under = run({ v0: 4.6, turns: -0.82, facing: 1, shape: 'tuck' }).prediction;
    expect(under.skill).not.toBe('unclassified');
    expect(under.movement?.somersaults).toBe(1);
    const over = run({ v0: 4.6, turns: -1.3, facing: 1, shape: 'tuck' }).prediction;
    expect(over.skill).toBe('unclassified');
  });

  it('still leaves a quarter rotation unnamed: the closest element is not a fair description', () => {
    const p = run({ v0: 4.6, turns: 1.25, shape: 'straight' }).prediction;
    expect(p.skill).toBe('unclassified');
    expect(p.failure?.kind).toBe('rotation-off-grid');
  });
});

/** The same synthetic jumps through the old and the new classifier: how many are named firmly, left unclassified, or guessed. */
describe('temporal against hierarchical, on the synthetic jumps', () => {
  const conditions: [Condition, { execution?: 'sloppy' | 'textbook' | 'loose' }][] = [
    [{ name: 'clean', noise: 0, dropout: 0, flip: 'none' }, {}],
    [{ name: 'jitter 2% + dropout 10%', noise: 0.02, dropout: 0.1, flip: 'none' }, {}],
    [{ name: 'sloppy, jitter 1%', noise: 0.01, dropout: 0, flip: 'none' }, { execution: 'sloppy' }],
    [
      { name: 'loose rotation (0.8-1.2 turns), sloppy shapes, jitter 2%', noise: 0.02, dropout: 0.05, flip: 'none' },
      { execution: 'loose' },
    ],
    [{ name: 'camera yaw 40°, jitter 1%', noise: 0.01, dropout: 0, flip: 'none', yawDeg: 40 }, {}],
  ];
  it.each(conditions)('%o', (condition, extra) => {
    const old = evaluate(condition, { routines: 20, classifier: hierarchicalClassifier, ...extra });
    const now = evaluate(condition, { routines: 20, classifier: temporalClassifier, ...extra });
    const firm = (s: typeof now) => s.rows.filter((r) => r.predicted !== 'unclassified' && r.certainty !== 'tentative');
    const unclassified = (s: typeof now) => s.rows.filter((r) => r.predicted === 'unclassified').length;
    console.log(
      `\n${condition.name}\n hierarchical: firm ${firm(old).length}, unclassified ${unclassified(old)}, confident-wrong ${old.confidentWrong}\n temporal:     firm ${firm(now).length}, unclassified ${unclassified(now)}, tentative ${now.tentative} (${now.tentativeCorrect} right), confident-wrong ${now.confidentWrong}\n${formatSummary(now)}`,
    );
    expect(now.confidentWrong).toBe(0);
    expect(firm(now).length).toBeGreaterThanOrEqual(firm(old).length);
    expect(firm(now).filter((r) => !r.correct).length).toBeLessThanOrEqual(firm(old).filter((r) => !r.correct).length);
  });
});
