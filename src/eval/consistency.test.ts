import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { syncRecords } from '../dataset/record';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import {
  consistencyBaselineOf,
  consistencyOf,
  consistencyRegressions,
  formatConsistency,
  inputsFromAnalysis,
  inputsFromRecords,
  pathTurnsOf,
  type ConsistencyInput,
} from './consistency';

/** A clean back somersault, as the pipeline would measure it. */
const clean = (id: string, over: Partial<ConsistencyInput> = {}): ConsistencyInput => ({
  id,
  videoId: 'v',
  complete: true,
  flightS: 1.4,
  turns: -1,
  pathTurns: 1,
  rotationConfidence: 0.9,
  reversalDeg: 5,
  maxStepDeg: 30,
  crossCheckDiffDeg: 4,
  residualDeg: 10,
  facingConfidence: 0.9,
  twistReliable: true,
  ...over,
});

describe('which flights are rotating', () => {
  it('keeps rotating flights and drops straight jumps, cut-off flights and the flights with no rotation', () => {
    const r = consistencyOf([
      clean('a'),
      clean('straight', { turns: 0.02, pathTurns: 0.05, residualDeg: 7, flightS: 2.5 }),
      clean('cut', { complete: false }),
    ]);
    expect(r.flights).toBe(2);
    expect(r.rotating).toBe(1);
    expect(r.jumps.map((j) => j.id)).toEqual(['a']);
  });

  it('keeps a long flight whose net rotation was lost to flips but whose orientation path shows it turned', () => {
    const lost = clean('lost', { turns: 0.2, pathTurns: 1.8, flightS: 1.7 });
    expect(consistencyOf([lost]).rotating).toBe(1);
    expect(consistencyOf([{ ...lost, flightS: 0.6 }]).rotating).toBe(0);
  });
});

describe('the checks', () => {
  it('passes a clean somersault on every check', () => {
    const r = consistencyOf([clean('a')]);
    expect(r.jumps[0].failing).toEqual([]);
    expect(r.clean).toEqual({ pass: 1, n: 1, share: 1 });
    expect(r.meanRotationConfidence).toBeCloseTo(0.9);
  });

  it('names the check a flight fails', () => {
    const fail = (over: Partial<ConsistencyInput>) => consistencyOf([clean('x', over)]).jumps[0].failing;
    expect(fail({ reversalDeg: 80 })).toEqual(['monotonic']);
    expect(fail({ maxStepDeg: 150 })).toEqual(['noFlip']);
    expect(fail({ crossCheckDiffDeg: -200 })).toEqual(['crossCheck']);
    expect(fail({ residualDeg: -80 })).toEqual(['onGrid']);
    expect(fail({ facingConfidence: 0.1 })).toEqual(['facing']);
    expect(fail({ twistReliable: false })).toEqual(['twist']);
  });

  it('does not count a missing body-line reading against the rotation, but a missing measurement fails', () => {
    expect(consistencyOf([clean('x', { crossCheckDiffDeg: null })]).jumps[0].failing).toEqual([]);
    const j = consistencyOf([clean('x', { reversalDeg: null })]).jumps[0];
    expect(j.checks.monotonic).toBeNull();
    expect(j.failing).toEqual(['monotonic']);
  });

  it('gives the share per check over the rotating flights, worst jumps first', () => {
    const r = consistencyOf([
      clean('good'),
      clean('flip', { maxStepDeg: 160, reversalDeg: 90, rotationConfidence: 0.1 }),
      clean('nofacing', { facingConfidence: 0 }),
      clean('flip2', { maxStepDeg: 130 }),
    ]);
    expect(r.rotating).toBe(4);
    expect(r.checks.noFlip).toEqual({ pass: 2, n: 4, share: 0.5 });
    expect(r.checks.monotonic.share).toBe(0.75);
    expect(r.checks.facing.share).toBe(0.75);
    expect(r.clean.share).toBe(0.5);
    expect(r.jumps[0].id).toBe('flip');
    expect(formatConsistency('t', r)).toContain('flip');
  });

  it('reports nothing to share when no flight rotates', () => {
    const r = consistencyOf([clean('s', { turns: 0, pathTurns: 0 })]);
    expect(r.rotating).toBe(0);
    expect(r.clean.share).toBeNull();
    expect(r.meanRotationConfidence).toBeNull();
    expect(formatConsistency('t', r)).toContain('0 rotating');
  });
});

describe('pathTurnsOf', () => {
  it('adds up the steps of the orientation column', () => {
    const seq = {
      columns: ['u', 'orient_turns'],
      data: [
        [0, 0],
        [0, 0.4],
        [0, 0.3],
        [0, 0.9],
      ],
    } as never;
    expect(pathTurnsOf(seq)).toBeCloseTo(0.4 + 0.1 + 0.6);
    expect(pathTurnsOf(null)).toBeNull();
  });
});

describe('the baseline', () => {
  const good = consistencyOf([clean('a'), clean('b')]);
  const worse = consistencyOf([clean('a'), clean('b', { maxStepDeg: 150 })]);

  it('is not worse than itself', () => {
    expect(consistencyRegressions(good, consistencyBaselineOf(good)).problems).toEqual([]);
  });

  it('says which share fell, and notes a different count without failing it', () => {
    const { problems } = consistencyRegressions(worse, consistencyBaselineOf(good));
    expect(problems.some((p) => p.startsWith('noFlip fell'))).toBe(true);
    expect(problems.some((p) => p.startsWith('clean rotation fell'))).toBe(true);
    const fewer = consistencyOf([clean('a')]);
    const r = consistencyRegressions(fewer, consistencyBaselineOf(good));
    expect(r.problems).toEqual([]);
    expect(r.notes).toHaveLength(1);
  });
});

describe('on analyzed jumps', () => {
  const { track } = mannequinRoutine({
    jumps: [
      { v0: 4.8, turns: -1, shape: 'tuck', facing: 1 },
      { v0: 4.4, shape: 'straight', facing: 1 },
    ],
    facing: 1,
  });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const skills = analyzeSkills(result);

  it('finds the somersault clean and the straight jump not rotating, from a fresh analysis and from the saved records alike', () => {
    const fresh = consistencyOf(inputsFromAnalysis(skills, null, 'v'));
    expect(fresh.rotating).toBe(1);
    expect(fresh.jumps[0].checks).toMatchObject({ monotonic: true, noFlip: true, crossCheck: true, onGrid: true });

    const records = syncRecords([], { videoId: 'v', fileName: '', result, skills, twist: null });
    const saved = consistencyOf(inputsFromRecords(records));
    expect(saved.rotating).toBe(1);
    expect(saved.jumps[0].turns).toBeCloseTo(fresh.jumps[0].turns ?? NaN, 3);
    expect(saved.jumps[0].pathTurns).not.toBeNull();
  });
});
