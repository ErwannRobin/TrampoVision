import { describe, expect, it } from 'vitest';
import { syncRecords, type RecordContext } from '../dataset/record';
import { analyzeSkills } from '../skills/analyzeSkills';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { mannequinRoutine } from '../skills/testMannequin';
import { analysisFingerprint } from '../dataset/record';
import { withExecution, withMovement, withTruth } from '../dataset/record';
import { movementOfElement } from '../dataset/movementLabel';
import { elementById } from '../skills/fig/elements';
import { chunk, forUpload, pendingRecords, syncStatusText, verdictOf } from './reviewSync';

const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'straight', facing: 1 },
    { v0: 4.4, shape: 'tuck', facing: 1 },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const ctx: RecordContext = { videoId: 'v-test', fileName: 'Emma Durand training.mp4', result, skills, twist: null };
const records = syncRecords([], ctx);

describe('review upload', () => {
  it('leaves the file name behind, since it can name the athlete', () => {
    const up = forUpload(records[0]);
    expect(up.source.fileName).toBe('');
    expect(JSON.stringify(up)).not.toContain('Emma');
    expect(records[0].source.fileName).toBe('Emma Durand training.mp4');
  });

  it('posts a jump once, and again only when its result changed', () => {
    const sent = new Map<string, string>();
    expect(pendingRecords(records, sent)).toHaveLength(2);
    for (const r of records) sent.set(r.id, analysisFingerprint(r));
    expect(pendingRecords(records, sent)).toHaveLength(0);
    // A label or a note changes the record but not the result: nothing to post.
    expect(pendingRecords([{ ...records[0], savedAt: 'later' }, records[1]], sent)).toHaveLength(0);
    const changed = { ...records[0], prediction: { ...records[0].prediction, skill: 'front' as const } };
    expect(pendingRecords([changed, records[1]], sent)).toEqual([changed]);
  });

  it('cuts a batch into requests the service accepts', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('tells what is happening', () => {
    expect(syncStatusText('sent', 1)).toBe('1 jump sent.');
    expect(syncStatusText('sent', 3)).toBe('3 jumps sent.');
    expect(syncStatusText('off', 0)).toContain('Nothing is uploaded');
    expect(syncStatusText('failed', 0)).toContain('Could not reach');
  });
});

describe('what the person says reaches the service as a verdict', () => {
  const tuck = records[1];
  const predicted = tuck.prediction.elementId!;

  it('confirms the figure the classifier named, and corrects to another one', () => {
    expect(predicted).toBe('none-0s-0t-tuck');
    const same = withMovement(tuck, movementOfElement(elementById(predicted)!));
    expect(verdictOf(same)).toEqual({ verdict: 'confirm' });
    const other = withMovement(tuck, movementOfElement(elementById('none-0s-0t-pike')!));
    expect(verdictOf(other)).toEqual({ verdict: 'correct', elementId: 'none-0s-0t-pike' });
  });

  it('says cannot tell when the person says it is none of the elements', () => {
    expect(verdictOf(withTruth(tuck, 'unknown'))).toEqual({ verdict: 'unknown' });
  });

  it('has no verdict for a record that only carries an execution score, or nothing', () => {
    expect(verdictOf(tuck)).toBeNull();
    expect(verdictOf(withExecution(tuck, 0.2, 0.1, 'test'))).toBeNull();
  });
});
