import { describe, expect, it } from 'vitest';
import type { TrampolineCalibration } from '../analysis/calibration';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import {
  compareJumps,
  confidenceTier,
  describeBedPosition,
  HIGH_CONFIDENCE,
  jumpHeadline,
  TIER_TEXT,
} from './insights';
import { analysisWarnings } from './quality';

describe('confidenceTier', () => {
  it('reads the classifier score against its own minimum', () => {
    expect(confidenceTier({ skill: 'tuck-jump', confidence: 0.9 }, 0.3)).toBe('high');
    expect(confidenceTier({ skill: 'tuck-jump', confidence: HIGH_CONFIDENCE }, 0.3)).toBe('high');
    expect(confidenceTier({ skill: 'tuck-jump', confidence: 0.45 }, 0.3)).toBe('medium');
    expect(confidenceTier({ skill: 'tuck-jump', confidence: 0.2 }, 0.3)).toBe('low');
  });
  it('tells a best guess from a jump that was never classified', () => {
    expect(confidenceTier({ skill: 'unclassified', confidence: 0.25 }, 0.3)).toBe('low');
    expect(confidenceTier({ skill: 'unclassified', confidence: 0 }, 0.3)).toBe('none');
    expect(TIER_TEXT.none).toBe('Not classified');
  });
});

describe('describeBedPosition', () => {
  it('names the middle, the sides and beyond', () => {
    expect(describeBedPosition(0.05)).toBe('in the center');
    expect(describeBedPosition(-0.5)).toBe('50% of the way to the left edge');
    expect(describeBedPosition(0.25)).toBe('25% of the way to the right edge');
    expect(describeBedPosition(1.2)).toBe('past the right edge');
    expect(describeBedPosition(null)).toBeNull();
    expect(describeBedPosition(NaN)).toBeNull();
  });
});

describe('jump headline and comparison on a synthetic routine', () => {
  const { track } = mannequinRoutine({
    jumps: [
      { v0: 4.0, shape: 'straight' },
      { v0: 5.0, shape: 'tuck' },
    ],
    facing: 1,
  });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const skills = analyzeSkills(result);

  it('reads the numbers of a jump straight from the analysis', () => {
    const h = jumpHeadline(skills, result, 1)!;
    const j = skills.jumps[1];
    expect(h.number).toBe(2);
    expect(h.label).toBe(j.prediction.label);
    expect(h.heightM).toBe(j.features.trajectory.maxHeightM);
    expect(h.flightTimeS).toBe(j.features.timing.flightTimeS);
    expect(h.bodyShape).toBe(j.features.position.label);
    expect(h.tier).toBe('high');
    expect(h.bed).toBeNull(); // the bed was not marked
  });

  it('returns null past the last jump', () => {
    expect(jumpHeadline(skills, result, 9)).toBeNull();
  });

  it('compares jumps with the best one of the clip, and only with it', () => {
    const rows = compareJumps(skills);
    expect(rows).toHaveLength(2);
    const [low, high] = rows;
    expect(high.heightShare).toBe(1);
    expect(high.flightShare).toBe(1);
    expect(low.heightShare).toBeGreaterThan(0);
    expect(low.heightShare).toBeLessThan(1);
    expect(low.flightShare).toBeLessThan(1);
  });

  it('has no bed position without a calibration, and one with it', () => {
    const corners: TrampolineCalibration['corners'] = [
      { x: 106, y: 640 },
      { x: 534, y: 640 },
      { x: 534, y: 560 },
      { x: 106, y: 560 },
    ];
    const calibrated = computeAnalysis(track, {
      athleteHeightM: 1.75,
      calibration: { corners, firstSideM: 4.28, secondSideM: 2.14 },
    });
    const h = jumpHeadline(analyzeSkills(calibrated), calibrated, 0)!;
    expect(h.heightReference).toBe('bed');
    expect(h.bed).not.toBeNull();
  });
});

describe('analysisWarnings', () => {
  it('has nothing to say about a clean synthetic clip', () => {
    const { track } = mannequinRoutine({ jumps: [{ v0: 4.4, shape: 'straight' }], facing: 1 });
    const result = computeAnalysis(track, { athleteHeightM: 1.75 });
    expect(analysisWarnings(result)).toEqual([]);
  });
});
