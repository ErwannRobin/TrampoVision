import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { syncRecords } from '../dataset/record';
import { toDatasetJson } from '../dataset/export';
import { withFigure } from '../dataset/record';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine, type MannequinJump } from '../skills/testMannequin';
import { baselineOf, causeOf, formatReport, parseLabelled, regressions, runEval } from './replay';

/** One video with a back tuck and a straight jump, as the records the app would upload. */
function video(videoId: string, jumps: MannequinJump[]) {
  const { track } = mannequinRoutine({ jumps, facing: 1 });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const skills = analyzeSkills(result);
  return syncRecords([], { videoId, fileName: '', result, skills, twist: null });
}
const [tuck, straight] = video('va', [
  { v0: 4.8, turns: -1, shape: 'tuck', facing: 1 },
  { v0: 4.4, shape: 'straight', facing: 1 },
]);

const row = (r: typeof tuck, status: string, review: string | null) =>
  JSON.stringify({ id: r.id, video_id: r.videoId, status, review_element_id: review, record: r });

describe('reading an export', () => {
  const text = [
    row(tuck, 'confirmed', 'back-1s-0t-tuck'),
    row({ ...straight, id: 'va:3', jumpId: 3 }, 'corrected', 'none-0s-0t-straight'),
    row({ ...straight, id: 'va:4', jumpId: 4 }, 'unknown', null),
    row({ ...straight, id: 'va:5', jumpId: 5 }, 'bad-data', null),
    row({ ...straight, id: 'va:6', jumpId: 6 }, 'auto', null),
  ].join('\n');

  it('takes the truth from confirmed and corrected rows only', () => {
    const jumps = parseLabelled(text);
    expect(jumps.map((j) => j.truth)).toEqual(['back-1s-0t-tuck', 'none-0s-0t-straight', null, null, null]);
    const r = runEval(jumps, { references: 'none' });
    expect(r.n).toBe(2);
    expect(r.skipped).toEqual({ unlabelled: 1, unknown: 1, badData: 1 });
  });

  it('refuses a figure that is not in the table', () => {
    expect(parseLabelled(row(tuck, 'confirmed', 'made-up'))[0].truth).toBe(null);
  });

  it('also reads a dataset file saved by the app, with the figure as the truth', () => {
    const file = toDatasetJson([withFigure(tuck, 'back-1s-0t-tuck'), straight]);
    const jumps = parseLabelled(file);
    expect(jumps.map((j) => j.truth)).toEqual(['back-1s-0t-tuck', null]);
  });
});

describe('scoring', () => {
  it('scores what the current classifier says against the reviewers, without any video', () => {
    const r = runEval(
      parseLabelled(
        [row(tuck, 'confirmed', 'back-1s-0t-tuck'), row(straight, 'confirmed', 'none-0s-0t-straight')].join('\n'),
      ),
      {
        references: 'none',
      },
    );
    expect(r).toMatchObject({ n: 2, correct: 2, top1: 1, confidentWrong: 0 });
    expect(r.perElement.map((e) => e.elementId).sort()).toEqual(['back-1s-0t-tuck', 'none-0s-0t-straight']);
    expect(r.calibration.reduce((s, b) => s + b.n, 0)).toBe(2);
  });

  it('counts a wrong review as a miss and says which part of the movement differed', () => {
    const r = runEval(parseLabelled(row(tuck, 'corrected', 'back-1s-0t-pike')), { references: 'none' });
    expect(r.correct).toBe(0);
    expect(r.causes.position).toBe(1);
    expect(r.confusions[0]).toEqual({ truth: 'back-1s-0t-pike', predicted: 'back-1s-0t-tuck', n: 1 });
    expect(r.outcomes[0].rank).not.toBe(null); // the tuck is also among the candidates for a pike
  });

  it('never gives a jump the examples of its own video', () => {
    // Two jumps of one video, one mislabelled: if it saw its neighbour as an example, the result would differ from "no examples".
    const same = parseLabelled(
      [
        row(tuck, 'corrected', 'back-1s-0t-pike'),
        row({ ...tuck, id: 'va:9', jumpId: 9 }, 'confirmed', 'back-1s-0t-tuck'),
      ].join('\n'),
    );
    const none = runEval(same, { references: 'none' });
    const lovo = runEval(same, { references: 'leave-one-video-out' });
    expect(lovo.outcomes.map((o) => [o.predicted, o.confidence])).toEqual(
      none.outcomes.map((o) => [o.predicted, o.confidence]),
    );
  });

  it('uses the reviewed jumps of other videos as examples', () => {
    const other = { ...tuck, id: 'vb:1', videoId: 'vb' };
    const jumps = parseLabelled(
      [row(tuck, 'confirmed', 'back-1s-0t-tuck'), row(other, 'confirmed', 'back-1s-0t-tuck')].join('\n'),
    );
    const lovo = runEval(jumps, { references: 'leave-one-video-out' });
    const none = runEval(jumps, { references: 'none' });
    // An identical jump of another video is a near-perfect example: it is what each jump matches best, and only the other video's.
    expect(lovo.outcomes.map((o) => o.usedExample)).toEqual([true, true]);
    expect(none.outcomes.some((o) => o.usedExample)).toBe(false);
    expect(lovo.outcomes[0].confidence).toBeGreaterThanOrEqual(none.outcomes[0].confidence);
    expect(formatReport('x', lovo)).toContain('Per element');
  });

  it('names the part that went wrong', () => {
    const p = (skill: string, movement: unknown) => ({ skill, movement }) as never;
    expect(causeOf('back-1s-0t-tuck', p('unclassified', undefined))).toBe('unclassified');
    expect(
      causeOf('back-1s-0t-tuck', p('back', { direction: 'back', somersaults: 1, twists: 0, position: 'pike' })),
    ).toBe('position');
    expect(
      causeOf('back-1s-0t-tuck', p('back', { direction: 'back', somersaults: 2, twists: 0, position: 'tuck' })),
    ).toBe('rotation');
    expect(
      causeOf(
        'back-1s-0t-straight'.replace('0t', '1t'),
        p('fig-element', { direction: 'back', somersaults: 1, twists: 0, position: 'straight' }),
      ),
    ).toBe('twist');
    expect(
      causeOf('back-1s-0t-tuck', p('front', { direction: 'front', somersaults: 1, twists: 0, position: 'tuck' })),
    ).toBe('direction');
    expect(causeOf('back-1s-0t-tuck', p('somersault-direction-unknown', undefined))).toBe('direction');
  });
});

describe('baseline', () => {
  const r = runEval(parseLabelled(row(tuck, 'confirmed', 'back-1s-0t-tuck')), { references: 'none' });
  it('passes on itself and fails on a worse result or a different set', () => {
    const base = baselineOf(r);
    expect(regressions(r, base)).toEqual([]);
    expect(regressions({ ...r, top1: 0.5 }, base)[0]).toContain('top-1 fell');
    expect(regressions({ ...r, confidentWrong: 1 }, base)[0]).toContain('confident-wrong rose');
    expect(regressions({ ...r, n: 3 }, base)[0]).toContain('the set changed');
    expect(regressions({ ...r, top1: 1 }, { ...base, top1: 0.5 })).toEqual([]);
  });
});
