import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import type { TwistEstimate } from '../pose3d/twist';
import { analyzeSkills } from './analyzeSkills';
import { mergeSkillConfig } from './config';
import { hierarchicalClassifier } from './hierarchical';
import { mannequinRoutine } from './testMannequin';
import { syntheticTwist2d } from './testTwist2d';
import { analyzeTwist2d, DEFAULT_TWIST2D_CONFIG, type Twist2dEstimate } from './twist2d';
import { estimateFrom2d, twistContextOf } from './twistContext';
import type { TwistContext } from './types';

const result = computeAnalysis(
  mannequinRoutine({ jumps: [{ v0: 4.8, turns: -1, shape: 'straight' }], facing: 1 }).track,
  {
    athleteHeightM: 1.75,
  },
);
const base = analyzeSkills(result).jumps[0];

const classify = (twist: TwistContext | null) =>
  hierarchicalClassifier.classify({
    cycle: base.cycle,
    features: base.features,
    sequence: base.sequence,
    twist,
    config: mergeSkillConfig(),
  });

/** The 2D estimate of a simulated jump with `turns` twists. */
const read2d = (turns: number): Twist2dEstimate =>
  analyzeTwist2d(syntheticTwist2d({ twistTurns: turns, somersaultTurns: 1 }, { noisePx: 1 }).input).jumps[0];

const est3d = (deg: number, reliable: boolean, confidence = 0.9): TwistEstimate =>
  ({
    available: true,
    totalDeg: deg,
    direction: 'positive',
    confidence,
    reliable,
  }) as TwistEstimate;

describe('which twist the classifier is told about', () => {
  const two = read2d(1);
  const traj = Array.from({ length: 32 }, (_, k) => (360 * k) / 31);

  it('keeps a reliable 3D twist and the 2D count next to it as a second opinion', () => {
    const ctx = twistContextOf(est3d(360, true), traj, two)!;
    expect(ctx.source).toBe('pose3d');
    expect(ctx.trajectory).toBe(traj);
    expect(ctx.second).toBe(two);
  });

  it('falls back on a reliable 2D count when the 3D twist is not reliable or missing, without a trajectory', () => {
    for (const e3 of [est3d(90, false, 0.1), null]) {
      const ctx = twistContextOf(e3, e3 ? traj : null, two)!;
      expect(ctx.source).toBe('pose2d');
      expect(ctx.trajectory).toBeNull();
      expect(ctx.estimate.available).toBe(true);
      expect(ctx.estimate.reliable).toBe(true);
      expect(ctx.estimate.totalDeg).toBe(360);
      expect(ctx.estimate.direction).toBe('none');
    }
  });

  it('does not use a 2D count that is not reliable', () => {
    const weak = { ...two, reliable: false, confidence: 0.2 };
    expect(twistContextOf(null, null, weak)).toBeNull();
    expect(twistContextOf(est3d(90, false, 0.1), traj, weak)!.source).toBe('pose3d');
    expect(estimateFrom2d(weak).reliable).toBe(false);
  });
});

describe('twist from 2D cues in the classifier', () => {
  it('names a twisting somersault from the 2D count alone and says where the twist came from', () => {
    const none = classify(null);
    expect(none.movement?.twists).toBe(0);
    expect(none.stages![2].measured).toBe(false);

    const p = classify(twistContextOf(null, null, read2d(1)));
    expect(p.movement).toMatchObject({ somersaults: 1, twists: 1 });
    expect(p.stages![2].measured).toBe(true);
    expect(p.stages![2].notes.join(' ')).toMatch(/2D skeleton/);
    expect(p.evidence.find((e) => e.key === 'twist_source')?.text).toMatch(/^2D cues/);
    expect(p.limitations.some((l) => l.id === 'twist-2d')).toBe(true);
  });

  it('weighs a 2D count by its own confidence', () => {
    const sure = read2d(1);
    const doubtful: Twist2dEstimate = { ...sure, confidence: DEFAULT_TWIST2D_CONFIG.minConfidence };
    const a = classify(twistContextOf(null, null, sure));
    const b = classify(twistContextOf(null, null, doubtful));
    expect(b.confidence).toBeLessThan(a.confidence);
  });

  it('lets a reliable 3D twist stand against a 2D count that disagrees, with less weight', () => {
    const traj = Array.from({ length: 32 }, (_, k) => (360 * k) / 31);
    const agree = classify(twistContextOf(est3d(360, true), traj, read2d(1)));
    const disagree = classify(twistContextOf(est3d(360, true), traj, read2d(2)));
    expect(agree.movement?.twists).toBe(1);
    expect(disagree.movement?.twists).toBe(1);
    expect(disagree.confidence).toBeLessThan(agree.confidence);
    expect(agree.stages![2].notes.join(' ')).toMatch(/counts the same/);
    expect(disagree.stages![2].notes.join(' ')).toMatch(/disagrees/);
    // The 3D twist is the source, whatever the 2D count says.
    expect(disagree.evidence.find((e) => e.key === 'twist_source')?.text).toBe('3D pose');
    expect(disagree.limitations.some((l) => l.id === 'twist-2d')).toBe(false);
  });

  it('reaches the classifier through analyzeSkills', () => {
    const twist2d = { config: DEFAULT_TWIST2D_CONFIG, jumps: [read2d(1)] };
    const p = analyzeSkills(result, { twist2d }).jumps[0].prediction;
    expect(p.movement?.twists).toBe(1);
  });
});
