import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../analysis/computeAnalysis';
import { syncRecords, withMovement, withTruth, type RecordContext } from '../../dataset/record';
import type { JumpRecord, TruthLabel } from '../../dataset/types';
import type { DatasetApi } from '../../dataset/useDataset';
import { analyzeSkills } from '../../skills/analyzeSkills';
import { mannequinRoutine } from '../../skills/testMannequin';
import { DatasetBar, EvaluatePanel, EvaluationReport, type EvaluatePanelProps } from '../EvaluationView';
import { Playhead } from '../playhead';

/** Four real jumps from the mannequin: straight, tuck, pike and a tuck with one turn. */
const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'straight', facing: 1 },
    { v0: 4.4, shape: 'tuck', facing: 1 },
    { v0: 4.4, shape: 'pike', facing: 1 },
    { v0: 4.6, shape: 'tuck', facing: 1, turns: 1 },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const ctx: RecordContext = { videoId: 'v-test', fileName: 'clip.mp4', result, skills, twist: null };
const fresh = syncRecords([], ctx);

const api = (records: JumpRecord[], over: Partial<DatasetApi> = {}): DatasetApi => ({
  ready: true,
  kind: 'indexeddb',
  warning: null,
  error: null,
  records,
  save: async () => {},
  remove: async () => {},
  clear: async () => {},
  importText: async () => ({ added: 0, updated: 0, kept: 0 }),
  ...over,
});

const label = (labels: (TruthLabel | null)[]) => fresh.map((r, k) => withTruth(r, labels[k] ?? null));

function panel(over: Partial<EvaluatePanelProps> = {}) {
  const records = over.fresh ?? fresh;
  const props: EvaluatePanelProps = {
    skills,
    selected: 1,
    onSelect: () => {},
    playhead: new Playhead(),
    videoId: 'v-test',
    fresh: records,
    savedIds: new Set(records.filter((r) => r.truth).map((r) => r.id)),
    staleCount: 0,
    dataset: api(records.filter((r) => r.truth)),
    baseName: 'clip',
    onMovement: () => {},
    onUnknown: () => {},
    exampleCounts: new Map(),
    onNote: () => {},
    onSaveAll: () => {},
    onUpdateStale: () => {},
    ...over,
  };
  return renderToStaticMarkup(createElement(EvaluatePanel, props));
}

const report = (records: JumpRecord[], over: { videoId?: string | null; scope?: 'video' | 'all' } = {}) =>
  renderToStaticMarkup(
    createElement(EvaluationReport, {
      records,
      videoId: over.videoId === undefined ? 'v-test' : over.videoId,
      scope: over.scope ?? 'video',
      onScope: () => {},
      baseName: 'clip',
      onGoTo: () => {},
    }),
  );

describe('EvaluatePanel', () => {
  it('offers the parts of a label, none chosen, a big confirm button, and the classifier answer', () => {
    const html = panel();
    // Position (4), somersaults (0-3), half twists (0-6 at no somersault: 0-3).
    expect(html).toContain('Confirm prediction');
    for (const text of ['Straight', 'Tuck', 'Pike', 'Straddle', 'Position', 'Somersaults', 'Half twists'])
      expect(html).toContain(text);
    expect(html).not.toContain('Direction');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain('Play jump');
    expect(html).toContain('Next unlabeled');
    expect(html).toContain(skills.jumps[1].prediction.label);
    expect(html).toContain('Watch the jump, then choose what it really was.');
    expect(html).not.toContain('Review jumps');
    expect(html).not.toContain('Previous jump');
  });

  it('fills the chosen label and says whether it matches the prediction', () => {
    const agree = panel({ fresh: label([null, 'tuck', null, null]) });
    expect(agree).toContain('Matches the prediction');
    expect(agree).toContain('Saved in this browser.');
    // The position, and the default of no somersault and no twist.
    expect(agree.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(agree).toContain('1</span> of <span class="num">4</span> labeled');

    const differ = panel({ fresh: label([null, 'pike', null, null]) });
    expect(differ).toContain('Differs from the prediction');
  });

  it('asks for the direction once there is a somersault', () => {
    const back = withMovement(fresh[1], { position: 'tuck', direction: null, somersaults: 1, halfTwists: 0 });
    expect(panel({ fresh: [fresh[0], back, fresh[2], fresh[3]] })).toContain('Direction');
  });

  it('cannot label before the video id is known, and says so', () => {
    const html = panel({ videoId: null, fresh: [] });
    expect(html).toContain('Reading the video id');
    expect(html.match(/class="review-label"[^>]*disabled/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it('disables the note until a label is chosen', () => {
    expect(panel()).toMatch(/<input[^>]*disabled[^>]*placeholder="e.g. camera moved/);
    expect(panel({ fresh: label([null, 'tuck', null, null]) })).not.toMatch(/<input[^>]*disabled/);
  });

  it('disables "Next unlabeled" once every jump has a label', () => {
    expect(panel({ fresh: label(['straight', 'tuck', 'pike', 'back']) })).toMatch(
      /<button[^>]*disabled[^>]*>Next unlabeled/,
    );
  });

  it('warns about predictions made with other settings, in the singular and the plural', () => {
    expect(panel({ staleCount: 1 })).toContain('1 saved jump of this video was predicted');
    expect(panel({ staleCount: 3 })).toContain('3 saved jumps of this video were predicted');
    expect(panel({ staleCount: 3 })).toContain('Update predictions');
    expect(panel()).not.toContain('Update predictions');
  });

  it('keeps the dataset behind a disclosure, with save all inside', () => {
    const html = panel();
    expect(html).toContain('Dataset on this computer');
    expect(html).toContain('No saved jumps');
    expect(html).toContain('Save all 4 jumps');
    expect(html).toContain('Import dataset…');
    expect(html).toContain('Delete all…');
  });

  it('says which figure a finished label saved as a reference example, with the example count', () => {
    const tuck = withMovement(fresh[1], { position: 'tuck', direction: 'back', somersaults: 1, halfTwists: 0 });
    const html = panel({
      fresh: [fresh[0], tuck, fresh[2], fresh[3]],
      exampleCounts: new Map([['back-1s-0t-tuck', 2]]),
    });
    expect(html).toContain('Saved as a reference example of Back somersault (tuck) (2 saved)');
    expect(panel()).not.toContain('reference example');
  });

  it('says there is nothing to label when no jump was found', () => {
    const html = panel({ skills: { ...skills, jumps: [] }, fresh: [] });
    expect(html).toContain('No jump found in this video, so there is nothing to label.');
    expect(html).toContain('Dataset on this computer');
    expect(html).not.toContain('Save all');
  });
});

describe('DatasetBar', () => {
  it('shows the counts of the closed row and inside it', () => {
    const html = renderToStaticMarkup(
      createElement(DatasetBar, { dataset: api(label(['tuck', 'pike', null, null])), baseName: 'clip' }),
    );
    expect(html).toContain('4 jumps, 2 labeled');
    expect(html).toContain('Stored in this browser (IndexedDB).');
  });

  it('keeps storage warnings and errors visible while it is closed', () => {
    const html = renderToStaticMarkup(
      createElement(DatasetBar, {
        dataset: api([], { kind: 'memory', warning: 'Local storage is blocked.', error: 'The database failed.' }),
        baseName: 'clip',
      }),
    );
    expect(html).toContain('Local storage is blocked.');
    expect(html).toContain('The database failed.');
    expect(html).toContain('Kept in memory only.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Dataset JSON/);
  });
});

describe('EvaluationReport', () => {
  it('asks for labels before showing any figure', () => {
    const html = report(fresh);
    expect(html).toContain('No labeled jumps yet.');
    expect(html).toContain('Review tab');
    expect(html).not.toContain('Accuracy');
    expect(html).toContain('Nothing labeled yet.');
  });

  it('shows the figures, both tables and the failures once jumps are labeled', () => {
    const html = report(label(['straight', 'tuck', 'tuck', 'back']));
    for (const text of ['Accuracy', 'Jumps evaluated', 'Balanced accuracy', 'Answered', 'Wrong at ≥60%']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Per class');
    expect(html).toContain('Confusion matrix');
    expect(html).toContain('Results per class');
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="colgroup"');
    expect(html).toContain('Failure cases');
    expect(html).toContain('Label against measurement');
    expect(html).toContain('What the classifier saw');
    expect(html).toContain('All extracted features');
    expect(html).toContain('Evaluation JSON');
    expect(html).toContain('Evaluation CSV');
    expect(html).toContain('review-spark__line');
  });

  it('tints the matrix by agreement and never by color alone', () => {
    const html = report(label(['straight', 'tuck', 'pike', 'pike']));
    expect(html).toContain('review-cell--agree');
    expect(html).toContain('review-cell--differ');
    expect(html).toContain('--strength:');
    expect(html).toContain(', agrees');
    expect(html).toContain(', differs');
    expect(html).toContain('Agrees with your label');
  });

  it('offers the scope switch only when a video is open, and links a failure to the video only then', () => {
    const labeled = label(['pike', 'tuck', 'tuck', 'back']);
    const open = report(labeled);
    expect(open).toContain('This video');
    expect(open).toContain('All saved videos');
    expect(open).toContain('Show this jump in the video');

    const landing = report(labeled, { videoId: null, scope: 'all' });
    expect(landing).not.toContain('All saved videos');
    expect(landing).not.toContain('Show this jump in the video');
    expect(landing).toContain('Failure cases');
  });

  it('says so when labels and predictions all agree', () => {
    const html = report(label(['straight', 'tuck', 'pike', null]));
    expect(html).toContain('No disagreement between your labels and the predictions.');
  });
});
