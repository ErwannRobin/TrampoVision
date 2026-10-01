import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { syncRecords } from '../dataset/record';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine, type MannequinJump } from '../skills/testMannequin';
import {
  APEX_TOLERANCE_S,
  applyLabels,
  blankLabelFile,
  elementOfLabel,
  formatStageReport,
  parseLabelFile,
  runStageEval,
  type JumpLabel,
  type LabelFile,
} from './labels';
import { parseLabelled, runEval } from './replay';
import { filmstripCommand, sheetCsv, sheetMarkdown, sheetRows } from './sheet';

function video(videoId: string, jumps: MannequinJump[]) {
  const { track } = mannequinRoutine({ jumps, facing: 1 });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const skills = analyzeSkills(result);
  return syncRecords([], { videoId, fileName: 'clip.mp4', result, skills, twist: null });
}
const [tuck, straight] = video('va', [
  { v0: 4.8, turns: -1, shape: 'tuck', facing: 1 },
  { v0: 4.4, shape: 'straight', facing: 1 },
]);

const row = (r: typeof tuck) => JSON.stringify({ id: r.id, video_id: r.videoId, status: 'auto', record: r });
const jumps = () => parseLabelled([row(tuck), row(straight)].join('\n'));

const label = (apexS: number, over: Partial<JumpLabel> = {}): JumpLabel => ({
  apexS,
  somersaults: null,
  direction: null,
  halfTwists: null,
  position: null,
  cannotTell: false,
  badSegmentation: false,
  ...over,
});
const file = (videoId: string, ...labels: JumpLabel[]): LabelFile => ({
  schema: 'trampovision.jump-labels',
  version: 1,
  videoId,
  jumps: labels,
});

const tuckLabel = { somersaults: 1, direction: 'back', halfTwists: 0, position: 'tuck' } as const;
const straightLabel = { somersaults: 0, direction: null, halfTwists: 0, position: 'straight' } as const;

describe('the label file', () => {
  it('round-trips a blank file, with blank fields read as not said', () => {
    const blank = blankLabelFile('va', 'clip.mp4', [{ apexS: 1.5, jumpId: 1 }]);
    const back = parseLabelFile(JSON.stringify(blank));
    expect(back.jumps[0]).toMatchObject({ apexS: 1.5, somersaults: null, direction: null, cannotTell: false });
    expect(parseLabelFile(JSON.stringify({ ...blank, jumps: [{ apexS: 2 }] })).jumps[0].position).toBe(null);
  });

  it('names the jump and the field of every mistake', () => {
    const bad = (j: unknown) => () =>
      parseLabelFile(JSON.stringify({ ...blankLabelFile('va', undefined, []), jumps: [j] }));
    expect(bad({ apexS: 1, somersaults: 0.3 })).toThrow(/jump 1: somersaults/);
    expect(bad({ apexS: 1, direction: 'left' })).toThrow(/direction must be one of front, back/);
    expect(bad({ apexS: 1, halfTwists: 1.5 })).toThrow(/halfTwists/);
    expect(bad({ apexS: 1, position: 'layout' })).toThrow(/position/);
    expect(bad({ apexS: 'x' })).toThrow(/apexS/);
    expect(bad({ apexS: 1, cannotTell: 'yes' })).toThrow(/cannotTell/);
    expect(() => parseLabelFile('{"schema":"other"}')).toThrow(/Not a/);
  });

  it('turns a complete label into an element, and nothing else', () => {
    expect(elementOfLabel({ ...tuckLabel })).toBe('back-1s-0t-tuck');
    expect(elementOfLabel({ ...straightLabel })).toBe('none-0s-0t-straight');
    expect(elementOfLabel({ somersaults: 2, direction: 'front', halfTwists: 2, position: 'straight' })).toBe(
      'front-2s-1t-straight',
    );
    expect(elementOfLabel({ ...tuckLabel, direction: null })).toBe(null); // a somersault needs a direction
    expect(elementOfLabel({ ...tuckLabel, somersaults: 0.75 })).toBe(null); // not in the table
    expect(elementOfLabel({ ...tuckLabel, position: null })).toBe(null);
    expect(elementOfLabel({ somersaults: 0, direction: null, halfTwists: 1, position: 'tuck' })).toBe(null);
  });
});

describe('putting labels on jumps', () => {
  it('matches by video and apex time, within the tolerance, and says what found nothing', () => {
    const a = tuck.timestamps.apexS;
    const b = straight.timestamps.apexS;
    const applied = applyLabels(jumps(), [
      file('va', label(a + APEX_TOLERANCE_S / 2, tuckLabel), label(b + 1, straightLabel)),
      file('other', label(a, tuckLabel)),
    ]);
    expect(applied.matched).toBe(1);
    expect(applied.unmatched.map((u) => u.videoId)).toEqual(['va', 'other']);
    expect(applied.jumps[0]).toMatchObject({ truth: 'back-1s-0t-tuck', source: 'local', stages: tuckLabel });
    expect(applied.jumps[1].truth).toBe(null);
  });

  it('gives a jump to the nearest of two labels', () => {
    const a = tuck.timestamps.apexS;
    const applied = applyLabels(jumps(), [
      file('va', label(a + 0.15, tuckLabel), label(a + 0.02, { ...tuckLabel, position: 'pike' })),
    ]);
    expect(applied.jumps[0].stages?.position).toBe('pike');
    expect(applied.unmatched).toHaveLength(1);
  });

  it('keeps a partial label as stages only, and marks the two "cannot score" flags', () => {
    const a = tuck.timestamps.apexS;
    const b = straight.timestamps.apexS;
    const partial = applyLabels(jumps(), [file('va', label(a, { position: 'tuck' }))]);
    expect(partial.jumps[0]).toMatchObject({ truth: null, stages: { position: 'tuck', somersaults: null } });
    const flags = applyLabels(jumps(), [
      file('va', label(a, { cannotTell: true }), label(b, { badSegmentation: true })),
    ]);
    expect(flags.jumps.map((j) => j.source)).toEqual(['unknown', 'bad-data']);
    expect(runEval(flags.jumps, { references: 'none' }).skipped).toEqual({ unlabelled: 0, unknown: 1, badData: 1 });
  });

  it('counts a label with nothing filled in as blank and leaves the jump alone', () => {
    const a = tuck.timestamps.apexS;
    const applied = applyLabels(jumps(), [file('va', label(a))]);
    expect(applied.blank).toBe(1);
    expect(applied.jumps[0].stages).toBeUndefined();
    expect(runStageEval(applied.jumps, { references: 'none' }).n).toBe(0);
  });

  it('feeds the figure-level score too', () => {
    const labelled = applyLabels(jumps(), [
      file('va', label(tuck.timestamps.apexS, tuckLabel), label(straight.timestamps.apexS, straightLabel)),
    ]).jumps;
    expect(runEval(labelled, { references: 'none' })).toMatchObject({ n: 2, correct: 2, top1: 1 });
  });
});

describe('scoring the stages', () => {
  const labelled = (a: Partial<JumpLabel>, b: Partial<JumpLabel>) =>
    applyLabels(jumps(), [file('va', label(tuck.timestamps.apexS, a), label(straight.timestamps.apexS, b))]).jumps;

  it('scores every stage of correct labels as right', () => {
    const r = runStageEval(labelled(tuckLabel, straightLabel), { references: 'none' });
    expect(r.n).toBe(2);
    expect(r.stages.rotation).toMatchObject({ n: 2, correct: 2, accuracy: 1 });
    expect(r.stages.direction).toMatchObject({ n: 1, correct: 1 }); // the straight jump has no direction to ask about
    expect(r.stages.twist).toMatchObject({ n: 2, correct: 2 });
    expect(r.stages.position).toMatchObject({ n: 2, correct: 2 });
    expect(r.rotationError.n).toBe(2);
    expect(Math.abs(r.rotationError.bias!)).toBeLessThan(0.3);
    expect(formatStageReport('x', r)).toContain('position');
  });

  it('says which stage was wrong, and only scores the stages that were labelled', () => {
    const r = runStageEval(
      labelled({ somersaults: 2, direction: 'front', halfTwists: 1, position: 'pike' }, { position: 'tuck' }),
      { references: 'none' },
    );
    expect(r.stages.rotation).toMatchObject({ n: 1, correct: 0 });
    expect(r.stages.direction).toMatchObject({ n: 1, correct: 0 });
    expect(r.stages.twist).toMatchObject({ n: 1, correct: 0 });
    expect(r.stages.position).toMatchObject({ n: 2, correct: 0 });
    expect(r.outcomes[0].stages.rotation).toMatchObject({ label: 2, predicted: 1, ok: false });
  });

  it('leaves quarter rotations to the measurement and keeps no-label jumps out', () => {
    const r = runStageEval(labelled({ somersaults: 0.75 }, {}), { references: 'none' });
    expect(r.n).toBe(1);
    expect(r.stages.rotation.n).toBe(0);
    expect(r.rotationOffGrid).toBe(1);
    expect(r.rotationError.n).toBe(1);
    expect(r.skipped.unlabelled).toBe(1);
  });

  it('never gives a jump the examples of its own video', () => {
    const l = labelled(tuckLabel, straightLabel);
    const none = runStageEval(l, { references: 'none' });
    const lovo = runStageEval(l, { references: 'leave-one-video-out' });
    expect(lovo.stages).toEqual(none.stages);
  });
});

describe('the labeling sheet', () => {
  const rows = sheetRows([straight, tuck]);

  it('lists the jumps in time order with what was measured', () => {
    expect(rows.map((r) => r.jumpId)).toEqual([...rows.map((r) => r.jumpId)].sort((x, y) => x - y));
    expect(rows[0]).toMatchObject({ videoId: 'va', fileName: 'clip.mp4' });
    const csv = sheetCsv(rows).split('\n');
    expect(csv[0]).toContain('apex_s');
    expect(csv).toHaveLength(rows.length + 2); // header, rows, trailing newline
  });

  it('writes an ffmpeg command that covers the flight, and quotes what needs it', () => {
    const cmd = filmstripCommand(rows[0], "my clips/it's.mp4", 'eval/sheets/va-strips');
    expect(cmd).toContain(`-ss ${Math.max(0, rows[0].takeoffS! - 0.1).toFixed(3)}`);
    expect(cmd).toContain(`'my clips/it'\\''s.mp4'`);
    expect(cmd).toContain('tile=6x2');
    expect(cmd).toMatch(/va-j\d\d\.png'?$/);
  });

  it('puts the commands in the markdown only when a video is given', () => {
    expect(sheetMarkdown(rows, { labelFile: 'eval/labels/va.json' })).toContain('--video');
    const md = sheetMarkdown(rows, {
      video: 'clip.mp4',
      stripDir: 'eval/sheets/va-strips',
      labelFile: 'eval/labels/va.json',
    });
    expect(md).toContain('```sh');
    expect(md.match(/^ffmpeg /gm)).toHaveLength(rows.length);
  });
});
