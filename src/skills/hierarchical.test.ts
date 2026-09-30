import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import type { TwistEstimate } from '../pose3d/twist';
import { analyzeSkills } from './analyzeSkills';
import { mergeSkillConfig } from './config';
import { describeClassification, diagnoseUnclassified, formatClassificationDebug, formatUnclassified } from './debug';
import { difficultyValue } from './fig/difficulty';
import { FIG_ELEMENTS, elementById, movementToElement } from './fig/elements';
import { hierarchicalClassifier } from './hierarchical';
import { mannequinRoutine, type MannequinJump } from './testMannequin';
import type { JumpSkillResult, TwistContext } from './types';

const run = (jump: MannequinJump) => {
  const { track } = mannequinRoutine({ jumps: [jump], facing: 1 });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  return analyzeSkills(result).jumps[0];
};

/** A twist context with a given net twist: a linear ramp, as a steady twist would be. */
function twistOf(deg: number, confidence = 0.9, reliable = true): TwistContext {
  const trajectory = Array.from({ length: 32 }, (_, k) => (deg * k) / 31);
  return {
    estimate: {
      available: true,
      totalDeg: deg,
      direction: deg > 0 ? 'positive' : 'negative',
      confidence,
      reliable,
    } as TwistEstimate,
    trajectory,
  };
}

const classifyWith = (
  j: JumpSkillResult,
  twist: TwistContext | null,
  config: Parameters<typeof mergeSkillConfig>[0] = {},
) =>
  hierarchicalClassifier.classify({
    cycle: j.cycle,
    features: j.features,
    sequence: j.sequence,
    twist,
    config: mergeSkillConfig(config),
  });

describe('element table', () => {
  it('has one row per movement, and movementToElement finds it', () => {
    expect(new Set(FIG_ELEMENTS.map((e) => e.id)).size).toBe(FIG_ELEMENTS.length);
    for (const e of FIG_ELEMENTS) expect(movementToElement(e)).toBe(e);
  });

  it('maps a movement to a named element and returns null outside the table', () => {
    const e = movementToElement({ direction: 'back', somersaults: 1, twists: 1, position: 'straight' });
    expect(e?.name).toBe('Back somersault, full twist (straight)');
    expect(movementToElement({ direction: 'back', somersaults: 4, twists: 0, position: 'tuck' })).toBeNull();
    expect(movementToElement({ direction: 'front', somersaults: 0, twists: 0, position: 'pike' })?.name).toBe(
      'Pike jump',
    );
  });

  it('gives every element the difficulty of the FIG rule and nothing else', () => {
    for (const e of FIG_ELEMENTS) expect(e.difficulty).toBe(difficultyValue(e));
    expect(elementById('back-1s-0t-tuck')?.difficulty).toBe(0.5);
    expect(elementById('back-2s-0t-pike')?.difficulty).toBe(1.3);
    expect(elementById('none-0s-0t-straight')?.difficulty).toBe(0);
  });

  it('marks the elements the Code of Points lists itself', () => {
    expect(elementById('back-2s-0t-tuck')?.inCode).toBe(true);
    expect(elementById('front-1s-0.5t-tuck')?.inCode).toBe(true); // Barani
    expect(elementById('front-1s-1.5t-straight')?.inCode).toBe(true); // Rudolph
    expect(elementById('front-3s-1t-tuck')?.inCode).toBe(false);
  });
});

describe('hierarchical classification', () => {
  const back = run({ v0: 4.8, turns: -1, shape: 'straight' });
  const tuck2 = run({ v0: 5.6, turns: -2, shape: 'tuck' });

  it('recognizes a somersault as movement + element, with the four stages reported', () => {
    const p = back.prediction;
    expect(p.movement).toMatchObject({ somersaults: 1, twists: 0, position: 'straight' });
    expect(p.elementId).toBe('back-1s-0t-straight');
    expect(p.stages?.map((s) => s.stage)).toEqual(['rotation', 'direction', 'twists', 'position']);
    expect(p.candidates?.[0].posterior).toBeGreaterThan(0.5);
  });

  it('names a double somersault instead of leaving it unclassified', () => {
    expect(tuck2.prediction.movement).toMatchObject({ somersaults: 2, position: 'tuck' });
    expect(tuck2.prediction.label).toMatch(/double somersault/);
  });

  it('reads the twist within a tolerance: 330° and 400° both mean one full twist', () => {
    for (const deg of [330, 360, 400]) {
      const p = classifyWith(back, twistOf(deg));
      expect(p.movement?.twists, `${deg}°`).toBe(1);
      expect(p.label).toBe('Back somersault, full twist (straight)');
    }
  });

  it('gets less sure between two twist counts, and lists the neighbour as an alternative', () => {
    const clean = classifyWith(back, twistOf(360));
    const between = classifyWith(back, twistOf(270));
    expect(between.confidence).toBeLessThan(clean.confidence * 0.7);
    const names = [between.candidates![0].name, between.candidates![1].name];
    expect(names.join('|')).toMatch(/½ twist|full twist/);
  });

  it('discounts a twist estimate that is below its own reliability limit', () => {
    const reliable = classifyWith(back, twistOf(360, 0.8, true));
    const doubtful = classifyWith(back, twistOf(360, 0.2, false));
    expect(doubtful.confidence).toBeLessThan(reliable.confidence);
  });

  it('marks the twist stage as not measured without 3D, and says so in the checks', () => {
    const p = classifyWith(back, null);
    expect(p.stages![2].measured).toBe(false);
    expect(p.candidates![0].checks.find((c) => c.stage === 'twists')!.status).toBe('unmeasured');
  });

  it('explains a quarter rotation: closest element, criterion, distances, and what would fix it', () => {
    const j = run({ v0: 4.6, turns: 1.25, shape: 'straight' });
    const p = classifyWith(j, null, { forceGuess: false });
    expect(p.skill).toBe('unclassified');
    expect(p.failure?.criterion).toBe('rotation');
    expect(p.failure?.closest).not.toBeNull();
    expect(p.failure?.distances.map((d) => d.stage)).toContain('rotation');
    expect(p.failure?.message).toMatch(/from the nearest whole somersault/);
  });

  it('names the closest element anyway when it is asked to guess, and keeps the reason it is weak', () => {
    const j = run({ v0: 4.6, turns: 1.25, shape: 'straight' });
    const p = classifyWith(j, null);
    expect(p.skill).not.toBe('unclassified');
    expect(p.elementId).toBe(p.failure?.closest?.elementId);
    expect(p.guess).toEqual({ closest: true, direction: false });
    expect(p.confidence).toBeLessThan(0.3);
    expect(p.failure?.criterion).toBe('rotation');
    expect(p.summary).toMatch(/^Best guess/);
  });

  it('never gives a confident answer when the threshold is not met, whatever it is lowered to', () => {
    // Confidence is the same number whatever the threshold; a lower threshold only moves the line.
    const strict = analyzeSkills(
      computeAnalysis(mannequinRoutine({ jumps: [{ v0: 4.6, turns: 1.25, shape: 'straight' }], facing: 1 }).track, {
        athleteHeightM: 1.75,
      }),
    ).jumps[0];
    expect(strict.prediction.confidence).toBeLessThan(0.3);
  });
});

describe('classification debug', () => {
  it('formats predicted, confidence, movement, evidence and alternatives', () => {
    const p = classifyWith(run({ v0: 4.8, turns: -1, shape: 'straight' }), twistOf(360));
    const d = describeClassification(p)!;
    expect(d.named).toBe(true);
    expect(d.evidence.map((e) => e.mark)).toEqual(['✓', '✓', '✓', '✓']);
    const text = formatClassificationDebug(p);
    expect(text).toMatch(/^Predicted:\nBack somersault, full twist \(straight\)/);
    expect(text).toContain('Movement:\nback / 1 somersault / 1 twist / straight');
    expect(text).toContain('Alternatives:');
  });

  it('lists every unclassified jump with its failure kind', () => {
    const { track } = mannequinRoutine({
      jumps: [
        { v0: 4.4, shape: 'tuck' },
        { v0: 4.6, turns: 1.25, shape: 'straight' },
      ],
      facing: 1,
    });
    const skills = analyzeSkills(computeAnalysis(track, { athleteHeightM: 1.75 }));
    const s = diagnoseUnclassified(skills);
    expect(s.total).toBe(2);
    expect(s.unclassified).toBe(1);
    expect(s.jumps[0].closest).not.toBeNull();
    expect(formatUnclassified(s)).toMatch(/1 of 2 jumps unclassified/);
  });
});
