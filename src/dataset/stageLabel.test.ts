import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { parseLabelFile } from '../eval/labels';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import { computeMetrics } from './metrics';
import { syncRecords, withMovement, withTruth } from './record';
import {
  EMPTY_ANSWERS,
  answersOfPrediction,
  answersOfRecord,
  applyLabelFile,
  disagreesWithGuess,
  figureOfAnswers,
  isComplete,
  labelFileOfRecords,
  labelFileText,
  movementOfAnswers,
  nextQuarter,
  reviewStatusOf,
  sameAnswers,
  stepTwists,
  tidyAnswers,
  withReviewFlag,
  withNote,
  withStageAnswers,
} from './stageLabel';
import type { StageAnswers } from './types';

const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.8, turns: -1, shape: 'tuck', facing: 1 },
    { v0: 4.4, shape: 'straight', facing: 1 },
    { v0: 4.6, shape: 'pike', facing: 1 },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const records = syncRecords([], { videoId: 'va', fileName: 'clip.mp4', result, skills, twist: null });
const [r0, r1, r2] = records;

const backTuck: StageAnswers = { somersaults: 1, direction: 'back', halfTwists: 0, position: 'tuck' };
const NOW = new Date('2026-10-01T10:00:00Z');

describe('answers', () => {
  it('are whole when every question that applies has an answer', () => {
    expect(isComplete(EMPTY_ANSWERS)).toBe(false);
    expect(isComplete(backTuck)).toBe(true);
    expect(isComplete({ ...backTuck, direction: null })).toBe(false);
    // A body that does not somersault has no direction to give.
    expect(isComplete({ somersaults: 0, direction: null, halfTwists: 0, position: 'pike' })).toBe(true);
    expect(isComplete({ ...backTuck, halfTwists: null })).toBe(false);
  });

  it('say the same thing whatever the direction of a flat jump', () => {
    const flat = { somersaults: 0, direction: null, halfTwists: 0, position: 'tuck' } as const;
    expect(sameAnswers(flat, { ...flat, direction: 'back' })).toBe(true);
    expect(sameAnswers(backTuck, { ...backTuck, direction: 'front' })).toBe(false);
    expect(sameAnswers(backTuck, { ...backTuck, halfTwists: 2 })).toBe(false);
    expect(tidyAnswers({ ...flat, direction: 'front' }).direction).toBe(null);
  });

  it('turn into the figure of the table, with its difficulty, when the table has it', () => {
    const e = figureOfAnswers(backTuck);
    expect(e?.id).toBe('back-1s-0t-tuck');
    expect(e?.difficulty).toBeGreaterThan(0);
    expect(figureOfAnswers({ ...backTuck, somersaults: 0.75 })).toBeNull(); // a quarter rotation is not in the table
    expect(figureOfAnswers({ ...backTuck, halfTwists: null })).toBeNull();
    expect(movementOfAnswers({ ...backTuck, direction: null })).toBeNull();
    expect(movementOfAnswers(backTuck)).toEqual({ position: 'tuck', direction: 'back', somersaults: 1, halfTwists: 0 });
  });

  it('keep what the classifier named as answers', () => {
    const named = answersOfPrediction(skills.jumps[0].prediction);
    expect(named).toEqual(backTuck);
    expect(answersOfPrediction({ movement: undefined })).toBeNull();
  });

  it('step through quarters of somersaults and half twists, within the offered range', () => {
    expect(nextQuarter(null)).toBe(0.25);
    expect(nextQuarter(1)).toBe(1.25);
    expect(nextQuarter(1.75)).toBe(1);
    expect(nextQuarter(0.75)).toBe(0);
    expect(stepTwists(null, 1)).toBe(1);
    expect(stepTwists(0, -1)).toBe(0);
    expect(stepTwists(8, 1)).toBe(8);
  });
});

describe('a record with answers', () => {
  it('stores whole answers as the figure, the movement and the half twists', () => {
    const r = withStageAnswers(r0, backTuck, NOW);
    expect(r.truth).toMatchObject({ label: 'back', stages: backTuck, movement: { somersaults: 1, position: 'tuck' } });
    expect(r.figure?.elementId).toBe('back-1s-0t-tuck');
    expect(r.twistTruth?.halfTwists).toBe(0);
    expect(reviewStatusOf(r)).toBe('done');
    expect(answersOfRecord(r)).toEqual(backTuck);
  });

  it('keeps partial answers as given and derives nothing from them', () => {
    const r = withStageAnswers(r0, { ...EMPTY_ANSWERS, position: 'tuck' }, NOW);
    expect(r.truth?.stages?.position).toBe('tuck');
    expect(r.truth?.label).toBe('unknown'); // not scored as a tuck jump while the somersaults are unknown
    expect(r.truth?.movement).toBeUndefined();
    expect(r.figure).toBeNull();
    expect(reviewStatusOf(r)).toBe('partial');
    expect(computeMetrics([r]).overall.n).toBe(0);
  });

  it('does not give a quarter rotation a five-way label, and leaves the figure out', () => {
    const r = withStageAnswers(r0, { ...backTuck, somersaults: 0.75 }, NOW);
    expect(r.truth?.label).toBe('unknown');
    expect(r.figure).toBeNull();
    expect(reviewStatusOf(r)).toBe('done');
  });

  it('is removed by blank answers, and keeps its note through a change', () => {
    const noted = {
      ...withStageAnswers(r0, backTuck, NOW),
      truth: { ...withStageAnswers(r0, backTuck, NOW).truth!, note: 'blurry' },
    };
    expect(withStageAnswers(noted, { ...backTuck, halfTwists: 2 }, NOW).truth?.note).toBe('blurry');
    const cleared = withStageAnswers(noted, EMPTY_ANSWERS, NOW);
    expect(cleared.truth).toBeNull();
    expect(cleared.figure).toBeNull();
    expect(reviewStatusOf(cleared)).toBe('unlabeled');
  });

  it('is flagged when the jump cannot be told or was cut at the wrong place', () => {
    const cannot = withReviewFlag(withStageAnswers(r0, backTuck, NOW), 'cannot-tell', NOW);
    expect(reviewStatusOf(cannot)).toBe('cannot-tell');
    expect(cannot.figure).toBeNull();
    expect(withReviewFlag(r0, 'bad-segmentation', NOW).truth?.flag).toBe('bad-segmentation');
    expect(reviewStatusOf(withReviewFlag(r0, 'bad-segmentation', NOW))).toBe('bad-segmentation');
    expect(withReviewFlag(cannot, null, NOW).truth).toBeNull();
  });

  it('reads the labels the app made before the review mode', () => {
    expect(reviewStatusOf(r0)).toBe('unlabeled');
    expect(reviewStatusOf(withTruth(r0, 'unknown'))).toBe('cannot-tell');
    const old = withMovement(r0, { position: 'tuck', direction: 'back', somersaults: 1, halfTwists: 0 });
    expect(reviewStatusOf(old)).toBe('done');
    expect(answersOfRecord(old)).toEqual(backTuck);
    expect(answersOfRecord(withTruth(r0, 'straight'))).toEqual({
      ...EMPTY_ANSWERS,
      somersaults: 0,
      halfTwists: 0,
      position: 'straight',
    });
  });

  it('disagrees with the guess only when the answers are whole and differ', () => {
    const guess = answersOfPrediction(skills.jumps[0].prediction);
    expect(disagreesWithGuess(withStageAnswers(r0, backTuck, NOW), guess)).toBe(false);
    expect(disagreesWithGuess(withStageAnswers(r0, { ...backTuck, position: 'pike' }, NOW), guess)).toBe(true);
    expect(disagreesWithGuess(withStageAnswers(r0, backTuck, NOW), null)).toBe(true);
    expect(disagreesWithGuess(r0, guess)).toBe(false);
    expect(disagreesWithGuess(withStageAnswers(r0, { ...EMPTY_ANSWERS, position: 'pike' }, NOW), guess)).toBe(false);
  });
});

describe('a note', () => {
  it('goes on a labelled jump, is trimmed, and is removed by an empty text', () => {
    const labelled = withStageAnswers(r0, backTuck, NOW);
    expect(withNote(labelled, '  camera moved ', NOW).truth?.note).toBe('camera moved');
    expect(withNote(withNote(labelled, 'x', NOW), '  ', NOW).truth).not.toHaveProperty('note');
    expect(withNote(r0, 'x', NOW)).toBe(r0);
  });
});

describe('the label file of a video', () => {
  const labelled = [
    withStageAnswers(r0, backTuck, NOW),
    withReviewFlag(r1, 'cannot-tell', NOW),
    withStageAnswers(r2, { ...EMPTY_ANSWERS, position: 'pike' }, NOW),
  ];

  it('has a line for each jump in time order, in the format `make eval` reads', () => {
    const file = labelFileOfRecords([...labelled].reverse(), 'va', 'clip.mp4');
    const back = parseLabelFile(labelFileText(file));
    expect(back).toMatchObject({ videoId: 'va', fileName: 'clip.mp4' });
    expect(back.jumps.map((j) => j.apexS)).toEqual(labelled.map((r) => r.timestamps.apexS).sort((a, b) => a - b));
    expect(back.jumps[0]).toMatchObject({
      somersaults: 1,
      direction: 'back',
      halfTwists: 0,
      position: 'tuck',
      cannotTell: false,
    });
    expect(back.jumps[1]).toMatchObject({ somersaults: null, cannotTell: true, badSegmentation: false });
    expect(back.jumps[2]).toMatchObject({ somersaults: null, position: 'pike' });
  });

  it('leaves out the jumps of other videos and gives blanks for the unlabeled', () => {
    const other = { ...r0, videoId: 'vb', id: 'vb:1' };
    const file = labelFileOfRecords([r0, other], 'va');
    expect(file.jumps).toHaveLength(1);
    expect(file.jumps[0]).toMatchObject({ somersaults: null, direction: null, halfTwists: null, position: null });
  });

  it('is put back on the jumps by their apex, one line per jump', () => {
    const file = labelFileOfRecords(labelled, 'va');
    const applied = applyLabelFile(file, records, NOW);
    expect(applied.matched).toBe(3);
    expect(applied.unmatched).toEqual([]);
    const byId = new Map(applied.records.map((r) => [r.id, r]));
    expect(reviewStatusOf(byId.get(r0.id)!)).toBe('done');
    expect(reviewStatusOf(byId.get(r1.id)!)).toBe('cannot-tell');
    expect(reviewStatusOf(byId.get(r2.id)!)).toBe('partial');
  });

  it('names the lines that found no jump, and leaves a jump with a blank line as it is', () => {
    const file = labelFileOfRecords(records, 'va');
    file.jumps.push({ ...file.jumps[0], apexS: 999, somersaults: 2 });
    const applied = applyLabelFile(file, records, NOW);
    expect(applied.unmatched.map((l) => l.apexS)).toEqual([999]);
    expect(applied.blank).toBe(3);
    expect(applied.records).toEqual([]);
  });

  it('carries a note across', () => {
    const file = labelFileOfRecords(records, 'va');
    file.jumps[0] = { ...file.jumps[0], ...backTuck, note: 'camera moved' };
    const applied = applyLabelFile(file, records, NOW);
    expect(applied.records[0].truth?.note).toBe('camera moved');
  });
});
