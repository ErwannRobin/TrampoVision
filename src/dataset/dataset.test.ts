import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analyzeTwist } from '../pose3d/twist';
import { syntheticTwistJump } from '../pose3d/testTwistMannequin';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine, type MannequinJump } from '../skills/testMannequin';
import type { SkillId } from '../skills/types';
import { buildEvaluationReport, parseDataset, recordViews, toDatasetCsv, toDatasetJson, toEvaluationCsv, toEvaluationJson } from './export';
import { checksFor, findFailures } from './failures';
import { agrees, computeMetrics, predictedClass, wilson } from './metrics';
import { isStale, matchRecord, syncRecords, withTruth, withTwistTruth, type RecordContext } from './record';
import { createMemoryStore, mergeRecords } from './store';
import { TRUTH_LABELS, type JumpRecord, type TruthLabel } from './types';
import { videoIdFromTrack, videoIdOf } from './videoId';

/** A record with only what the metrics read. */
const fake = (truth: TruthLabel | null, skill: SkillId, confidence = 0.8, id = Math.random().toString(36)): JumpRecord =>
  ({ id, videoId: 'v', jumpId: 1, truth: truth ? { label: truth, labeledAt: 'x' } : null, prediction: { skill, confidence } }) as unknown as JumpRecord;

describe('predictions in the label space', () => {
  it('maps every skill id and treats "unknown" as agreeing only with "not classified"', () => {
    expect(predictedClass('straight-jump')).toBe('straight');
    expect(predictedClass('somersault-direction-unknown')).toBe('somersault');
    expect(predictedClass('unclassified')).toBe('none');
    expect(agrees('unknown', 'none')).toBe(true);
    expect(agrees('unknown', 'straight')).toBe(false);
    expect(agrees('tuck', 'none')).toBe(false);
  });
});

describe('metrics', () => {
  const records = [
    ...[0, 1, 2].map(() => fake('straight', 'straight-jump')),
    fake('straight', 'tuck-jump', 0.5),
    fake('tuck', 'tuck-jump'),
    fake('tuck', 'tuck-jump'),
    fake('tuck', 'unclassified', 0),
    fake('back', 'back'),
    fake('back', 'back'),
    fake('back', 'front', 0.9),
    fake('unknown', 'straight-jump'),
    fake(null, 'pike-jump'),
  ];
  const m = computeMetrics(records);

  it('counts what is labeled, known, unknown and unlabeled', () => {
    expect(m.counts).toEqual({ records: 12, labeled: 11, known: 10, unknown: 1, unlabeled: 1 });
    expect(m.samplesPerClass).toEqual({ straight: 4, tuck: 3, pike: 0, back: 3, front: 0, unknown: 1 });
  });

  it('computes accuracy over the known labels only, counting non-answers as wrong', () => {
    expect(m.overall.n).toBe(10);
    expect(m.overall.correct).toBe(7);
    expect(m.overall.accuracy).toBeCloseTo(0.7);
    expect(m.overall.answered).toBe(9);
    expect(m.overall.coverage).toBeCloseTo(0.9);
    expect(m.overall.accuracyWhenAnswered).toBeCloseTo(7 / 9);
    expect(m.overall.confidentWrong).toBe(1); // back -> front at 0.9
  });

  it('gives a Wilson interval instead of a bare percentage', () => {
    expect(m.overall.ci95!.lo).toBeCloseTo(0.397, 2);
    expect(m.overall.ci95!.hi).toBeCloseTo(0.892, 2);
    expect(wilson(0, 0)).toBeNull();
    const all = wilson(3, 3)!;
    expect(all.hi).toBe(1);
    expect(all.lo).toBeLessThan(0.5); // "3 of 3" is not "certainly 100%"
  });

  it('computes precision, recall and one-vs-rest accuracy per class', () => {
    const c = Object.fromEntries(m.perClass.map((p) => [p.label, p]));
    expect(c.straight).toMatchObject({ support: 4, predicted: 3, correct: 3, precision: 1, recall: 0.75 });
    expect(c.straight.accuracyOneVsRest).toBeCloseTo(0.9);
    expect(c.tuck.precision).toBeCloseTo(2 / 3);
    expect(c.tuck.recall).toBeCloseTo(2 / 3);
    expect(c.back).toMatchObject({ support: 3, predicted: 2, precision: 1 });
    expect(c.pike).toMatchObject({ support: 0, predicted: 0, precision: null, recall: null });
    expect(c.front).toMatchObject({ support: 0, predicted: 1, precision: 0, recall: null });
    expect(m.overall.balancedAccuracy).toBeCloseTo((0.75 + 2 / 3 + 2 / 3) / 3);
  });

  it('builds the confusion matrix with the unknown row and both non-answers', () => {
    const { rows, columns, counts } = m.matrix;
    const at = (t: string, p: string) => counts[rows.indexOf(t as TruthLabel)][columns.indexOf(p as never)];
    expect(at('straight', 'straight')).toBe(3);
    expect(at('straight', 'tuck')).toBe(1);
    expect(at('tuck', 'none')).toBe(1);
    expect(at('back', 'front')).toBe(1);
    expect(at('unknown', 'straight')).toBe(1);
    expect(counts.flat().reduce((s, v) => s + v, 0)).toBe(11); // every labeled jump appears once
  });

  it('is empty-safe', () => {
    const e = computeMetrics([]);
    expect(e.overall.accuracy).toBeNull();
    expect(e.perClass.every((c) => c.precision === null && c.recall === null)).toBe(true);
  });
});

describe('records from a real analysis', () => {
  const jumps: MannequinJump[] = [
    { v0: 4.4, shape: 'straight', facing: 1 },
    { v0: 4.4, shape: 'tuck', facing: 1 },
    { v0: 4.4, shape: 'pike', facing: 1 },
    { v0: 4.6, shape: 'tuck', facing: 1, turns: 1 },
  ];
  const { track } = mannequinRoutine({ jumps, facing: 1 });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const build = (skillsConfig?: Parameters<typeof analyzeSkills>[1]): RecordContext => {
    const skills = analyzeSkills(result, skillsConfig);
    return { videoId: 'v-test', fileName: 'clip.mp4', result, skills, twist: null, now: new Date('2026-01-01T00:00:00Z') };
  };
  const ctx = build();
  const saved = syncRecords([], ctx);

  it('makes one record per jump with the requested content', () => {
    expect(saved).toHaveLength(4);
    const r = saved[1];
    expect(r.id).toBe('v-test:2');
    expect(r.videoId).toBe('v-test');
    expect(r.jumpId).toBe(2);
    expect(r.timestamps.takeoffS).toBeLessThan(r.timestamps.apexS);
    expect(r.timestamps.apexS).toBeLessThan(r.timestamps.landingS!);
    expect(r.sequence!.data).toHaveLength(32);
    expect(r.features.shape.hipAngle.atPeak).not.toBeNull();
    expect(r.prediction.skill).toBe('tuck-jump');
    expect(r.prediction.confidence).toBeGreaterThan(0.5);
    expect(r.analysis.config.position.hipFoldedMaxDeg).toBe(125);
    expect(r.truth).toBeNull();
  });

  it('exports named views: skeleton, COM trajectory, orientation, angular velocity, joint angles', () => {
    const v = recordViews(saved[3]);
    expect(v.skeleton!.joints).toContain('left_hip');
    expect(v.skeleton!.data).toHaveLength(32);
    expect(v.skeleton!.data[0]).toHaveLength(v.skeleton!.joints.length);
    expect(Object.keys(v.signals!)).toEqual(expect.arrayContaining(['comTrajectory', 'bodyOrientation', 'angularVelocityTurnsPerS', 'jointAngles']));
    expect(v.signals!.bodyOrientation.turnsSinceTakeoff.at(-1)!).toBeGreaterThan(0.8);
    expect(v.signals!.jointAngles.hipDeg).toHaveLength(32);
  });

  it('keeps id, number and label when the jumps are saved again, and takes the new measurements', () => {
    const labeled = saved.map((r, k) => withTruth(r, (['straight', 'tuck', 'pike', 'back'] as const)[k]));
    const again = syncRecords(labeled, build({ config: { position: { hipFoldedMaxDeg: 20, hipOpenMinDeg: 40 } } }));
    expect(again.map((r) => r.id)).toEqual(labeled.map((r) => r.id));
    expect(again.map((r) => r.truth?.label)).toEqual(['straight', 'tuck', 'pike', 'back']);
    expect(again[1].analysis.config.position.hipFoldedMaxDeg).toBe(20);
    expect(again[1].prediction.skill).not.toBe('tuck-jump'); // with a hip at 55° and "folded" now meaning 20° or less, the tuck no longer counts
  });

  it('numbers a new jump like on screen (jump 3 = record 3), can save just some, and never reuses a taken number', () => {
    const one = syncRecords([], ctx, [2]);
    expect(one).toHaveLength(1);
    expect(one[0].jumpId).toBe(3);
    const later = syncRecords(one, ctx, [0]);
    expect(later[0].jumpId).toBe(1);
    // Saved alone, a jump gets the same number as when the whole video is saved.
    expect(syncRecords([], ctx).map((r) => r.jumpId)).toEqual([1, 2, 3, 4]);
    // An old record that sits on another jump's number pushes the new one to the next free number.
    const odd = { ...one[0], id: 'v-test:1', jumpId: 1, timestamps: { ...one[0].timestamps, apexS: 99 } };
    expect(syncRecords([odd], ctx, [0])[0].jumpId).toBe(2);
    expect(matchRecord(one, ctx.skills.jumps[2].cycle.apexTimeS)?.id).toBe(one[0].id);
    expect(matchRecord(one, 99)).toBeUndefined();
  });

  it('tells a stale record from a current one', () => {
    const fresh = syncRecords(saved, build({ config: { position: { hipFoldedMaxDeg: 20, hipOpenMinDeg: 40 } } }));
    expect(isStale(saved[1], syncRecords(saved, ctx)[1])).toBe(false);
    expect(isStale(saved[1], fresh[1])).toBe(true);
  });

  it('turns a label into measurable requirements and shows where the measurement differs', () => {
    // The tuck jump labeled as pike: the position check must be the one that is off.
    const checks = checksFor(withTruth(saved[1], 'pike'), 'pike');
    const pos = checks.find((c) => c.signal === 'Body position')!;
    expect(pos.status).toBe('off');
    expect(pos.expected).toContain('at least 150');
    expect(pos.measured).toContain('tuck');
    expect(checks.find((c) => c.signal === 'Rotation')!.status).toBe('ok');
    // The mannequin faces right and turns clockwise: that is a front somersault. Labeled back, the direction check is off; labeled front, ok.
    const dirOf = (label: 'back' | 'front') => checksFor(withTruth(saved[3], label), label).find((c) => c.signal === 'Somersault direction')!;
    expect(dirOf('back').status).toBe('off');
    expect(dirOf('back').measured).toBe('clockwise, facing right: front');
    expect(dirOf('front').status).toBe('ok');
    expect(checksFor(withTruth(saved[3], 'front'), 'front').find((c) => c.signal === 'Rotation')!.status).toBe('ok');
  });

  it('lists every disagreement, confident wrong answers first, and hides nothing', () => {
    const wrong = [withTruth(saved[0], 'tuck'), withTruth(saved[1], 'tuck'), withTruth(saved[2], 'straight'), withTruth(saved[3], 'unknown')];
    const failures = findFailures(wrong);
    expect(failures.map((f) => f.record.jumpId).sort()).toEqual([1, 3, 4]); // jump 2 is right
    expect(failures.every((f) => f.checks.length >= 2)).toBe(true); // even an "unknown" label gets the data-quality checks
    const confs = failures.map((f) => f.confidence);
    expect(confs).toEqual([...confs].sort((a, b) => b - a));
    const low = findFailures([withTruth({ ...saved[0], prediction: { ...saved[0].prediction, confidence: 0.1 } }, 'tuck')]);
    expect(low).toHaveLength(1);
    expect(low[0].lowConfidence).toBe(true);
    // A jump labeled Unknown that the classifier named anyway says so in its checks.
    const unk = failures.find((f) => f.truth === 'unknown')!;
    expect(unk.checks[0]).toMatchObject({ signal: 'Classifier answer', status: 'off' });
    // Unlabeled jumps are never failures.
    expect(findFailures(saved)).toHaveLength(0);
  });

  it('exports and re-imports the dataset without loss', () => {
    const labeled = saved.map((r, k) => withTruth(r, (['straight', 'tuck', 'pike', 'back'] as const)[k], { note: 'a, "quoted" note' }));
    const json = toDatasetJson(labeled, new Date('2026-01-02T00:00:00Z'));
    expect(json).not.toContain('NaN');
    const back = parseDataset(json);
    expect(back).toHaveLength(4);
    expect(back[0].id).toBe(labeled[0].id);
    expect(back[0].truth).toEqual(labeled[0].truth);
    expect(back[0].features.rotation.totalDeg).toBeCloseTo(labeled[0].features.rotation.totalDeg!, 3);
    expect(back[0].sequence!.data.length).toBe(32);
    expect((back[0] as unknown as { views?: unknown }).views).toBeUndefined();
    expect(() => parseDataset('{"schema":"other"}')).toThrow(/not a TrampoVision dataset/);
    expect(() => parseDataset('nope')).toThrow(/not valid JSON/);
  });

  it('writes one CSV row per jump with the label, the prediction and whether it was right', () => {
    const labeled = saved.map((r, k) => withTruth(r, (['straight', 'tuck', 'tuck', 'unknown'] as const)[k], { note: 'a, "b"' }));
    const rows = toDatasetCsv(labeled).split('\n');
    const head = rows[0].split(',');
    expect(rows).toHaveLength(5);
    expect(head.slice(0, 6)).toEqual(['video_id', 'jump_id', 'file_name', 'truth', 'predicted', 'correct']);
    expect(head).toEqual(expect.arrayContaining(['hip_angle_at_peak_deg', 'rotation_deg', 'skill_confidence', 'twist_deg']));
    expect(rows[1]).toMatch(/^v-test,1,clip.mp4,straight,straight,1,/);
    expect(rows[3]).toContain(',tuck,pike,0,'); // labeled tuck, predicted pike
    expect(rows[4]).toContain(',unknown,'); // unknown: no correct/incorrect
    expect(rows[4].split(',')[5]).toBe('');
    expect(rows[1]).toContain('"a, ""b"""');
  });

  it('exports the evaluation as JSON and as one CSV table', () => {
    const labeled = saved.map((r, k) => withTruth(r, (['straight', 'tuck', 'tuck', 'front'] as const)[k]));
    const report = buildEvaluationReport(labeled, { kind: 'all' });
    expect(report.metrics.overall.n).toBe(4);
    expect(report.failures).toHaveLength(1);
    expect(report.distinctConfigs).toBe(1);
    expect(report.jumps.map((j) => j.correct)).toEqual([true, true, false, expect.any(Boolean)]);
    expect(JSON.parse(toEvaluationJson(report)).schema).toBe('trampovision.evaluation');
    const csv = toEvaluationCsv(report.metrics).split('\n');
    expect(csv[0]).toContain('true_label,samples,predicted_as_this,correct,precision,recall');
    expect(csv[0]).toContain('pred_none');
    expect(csv[1].startsWith('Straight,1,')).toBe(true);
    expect(csv.find((l) => l.startsWith('accuracy,'))).toBeTruthy();
  });

  it('stores the twist estimate and the annotator twist count separately from the skill label', () => {
    const s = syntheticTwistJump({ somersaultTurns: 1, twistTurns: 1 });
    const twist = analyzeTwist({ ...s.input, cycles: [{ ...s.input.cycles[0] }] });
    // One synthetic jump only: reuse the first record's context but with this twist analysis as jump 0.
    const rec = syncRecords([], { ...ctx, twist: { ...twist, jumps: [twist.jumps[0], twist.jumps[0], twist.jumps[0], twist.jumps[0]] } }, [0])[0];
    expect(rec.twist).not.toBeNull();
    const annotated = withTwistTruth(rec, 2);
    expect(annotated.twistTruth?.halfTwists).toBe(2);
    expect(annotated.truth).toBeNull(); // annotating twists does not label the skill
    expect(withTwistTruth(annotated, null).twistTruth).toBeNull();
  });
});

describe('local storage and merging', () => {
  const rec = (id: string, savedAt: string, label: TruthLabel | null = null) => ({ ...fake(label, 'straight-jump', 0.8, id), savedAt }) as JumpRecord;

  it('keeps records in the store, replaces by id and clears', async () => {
    const store = createMemoryStore([rec('a', '1')]);
    await store.put([rec('b', '1'), rec('a', '2', 'tuck')]);
    const all = await store.all();
    expect(all.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(all.find((r) => r.id === 'a')!.truth?.label).toBe('tuck');
    await store.remove(['a']);
    expect((await store.all()).map((r) => r.id)).toEqual(['b']);
    await store.clear();
    expect(await store.all()).toEqual([]);
  });

  it('merges an imported dataset: new ids are added, the newer copy wins, an older copy is ignored', () => {
    const existing = [rec('a', '2026-01-02'), rec('b', '2026-01-02')];
    const incoming = [rec('a', '2026-01-01', 'tuck'), rec('b', '2026-01-03', 'pike'), rec('c', '2026-01-01')];
    const { toPut, added, updated, kept } = mergeRecords(existing, incoming);
    expect({ added, updated, kept }).toEqual({ added: 1, updated: 1, kept: 1 });
    expect(toPut.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });
});

describe('video id', () => {
  it('is the same for the same bytes, whatever the file is called, and differs when the content differs', async () => {
    const a = new Blob([new Uint8Array(1000).map((_, i) => i % 251)]);
    const b = new Blob([new Uint8Array(1000).map((_, i) => i % 251)]);
    const c = new Blob([new Uint8Array(1000).map((_, i) => (i + 1) % 251)]);
    expect(await videoIdOf(a)).toBe(await videoIdOf(b));
    expect(await videoIdOf(a)).not.toBe(await videoIdOf(c));
    expect(await videoIdOf(a)).toMatch(/^v-[0-9a-f]{12}$/);
  });
  it('has a fallback id for saved data without the video', () => {
    const { track } = mannequinRoutine({ jumps: [{ v0: 4.4, shape: 'straight' }] });
    expect(videoIdFromTrack('a.mp4', track)).toBe(videoIdFromTrack('a.mp4', track));
    expect(videoIdFromTrack('a.mp4', track)).not.toBe(videoIdFromTrack('b.mp4', track));
    expect(videoIdFromTrack('a.mp4', track)).toMatch(/^s-/);
  });
});

describe('labels', () => {
  it('has the six labels the annotator can give', () => {
    expect([...TRUTH_LABELS]).toEqual(['straight', 'tuck', 'pike', 'back', 'front', 'unknown']);
  });
});
