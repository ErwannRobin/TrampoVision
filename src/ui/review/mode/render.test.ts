import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../../analysis/computeAnalysis';
import { syncRecords } from '../../../dataset/record';
import { answersOfPrediction, withReviewFlag, withStageAnswers } from '../../../dataset/stageLabel';
import { analyzeSkills } from '../../../skills/analyzeSkills';
import { mannequinRoutine } from '../../../skills/testMannequin';
import { Playhead } from '../../playhead';
import { ReviewMode, type ReviewModeProps } from './ReviewMode';

const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.6, shape: 'tuck', facing: 1, turns: -1 },
    { v0: 4.4, shape: 'straight', facing: 1 },
    { v0: 4.4, shape: 'pike', facing: 1 },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const fresh = syncRecords([], { videoId: 'v-test', fileName: 'clip.mp4', result, skills, twist: null });

function render(over: Partial<ReviewModeProps> = {}) {
  const props: ReviewModeProps = {
    skills,
    records: fresh,
    selected: 0,
    onSelect: () => {},
    playhead: new Playhead(),
    speed: 0.5,
    onSpeed: () => {},
    videoId: 'v-test',
    fileName: 'clip.mp4',
    baseName: 'clip',
    onSave: () => {},
    onClose: () => {},
    storageWarning: null,
    ...over,
  };
  return renderToStaticMarkup(createElement(ReviewMode, props));
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const pressed = (html: string, on: boolean) => (html.match(new RegExp(`aria-pressed="${on}"`, 'g')) ?? []).length;

describe('the review mode', () => {
  it('shows one jump with the progress, the strip of every jump, the four questions and what the classifier says', () => {
    const html = render();
    expect(html).toContain('Jump 1 of 3');
    expect(text(html)).toContain('0 of 3 done');
    expect(html.match(/class="rm-jumpchip/g)).toHaveLength(3);
    for (const q of ['Somersaults', 'Direction', 'Half twists', 'Position']) expect(html).toContain(q);
    expect(html.match(/class="rm-chip"/g)).toHaveLength(13 + 2 + 9 + 3);
    expect(html).toContain('The classifier says');
    expect(html).toContain('Accept: Back somersault (tuck)');
    expect(html).toContain('Not labeled');
  });

  it('plays the jump of the strip that is selected, and dims the ones the filter leaves out', () => {
    const html = render({
      selected: 1,
      records: [withStageAnswers(fresh[0], answersOfPrediction(skills.jumps[0].prediction)!), fresh[1], fresh[2]],
    });
    expect(html).toContain('Jump 2 of 3');
    expect(html).toMatch(/aria-current="true"[^>]*>2</);
    expect(text(html)).toContain('1 of 3 done');
  });

  it('names the figure and its difficulty once the four questions have an answer, and marks the answers given', () => {
    const answers = answersOfPrediction(skills.jumps[0].prediction)!;
    const html = render({ records: [withStageAnswers(fresh[0], answers), fresh[1], fresh[2]] });
    expect(html).toMatch(/Back somersault \(tuck\) · difficulty \d/);
    expect(html).toContain('Classifier accepted');
    expect(html).toContain('Labeled');
    // the somersault count, the direction, the twist count and the position
    expect(pressed(html, true)).toBeGreaterThanOrEqual(4);
  });

  it('keeps partial answers open and says what is missing', () => {
    const html = render({
      records: [
        withStageAnswers(fresh[0], { somersaults: 1, direction: null, halfTwists: null, position: 'tuck' }),
        fresh[1],
        fresh[2],
      ],
    });
    expect(html).toContain('Partly labeled');
    expect(html).toContain('Answered in part');
  });

  it('says so when the jump cannot be told, and leaves no answer pressed', () => {
    const html = render({ records: [withReviewFlag(fresh[0], 'cannot-tell'), fresh[1], fresh[2]] });
    expect(html).toContain('Marked: cannot tell');
    expect(html).not.toMatch(/class="rm-chip" aria-pressed="true"/);
  });

  it('points out the data problems and the candidates with a mark for each question', () => {
    const html = render();
    expect(html).toContain('Check the data');
    expect(html).toContain('What was measured');
    expect(html).toContain('rm-candidate');
    expect(html).toMatch(/class="rm-check" data-status="(match|weak|mismatch|unmeasured)"/);
  });

  it('cannot label until the video id is known, and shows a storage warning', () => {
    const html = render({ videoId: null, storageWarning: 'Storage is blocked.' });
    expect(html).toContain('Storage is blocked.');
    expect(html).toContain('Reading the video id');
    expect(html).toMatch(/class="rm-chip"[^>]*disabled/);
  });

  it('has nothing to review in a clip without a jump', () => {
    const empty = analyzeSkills(
      computeAnalysis(mannequinRoutine({ jumps: [], facing: 1 }).track, { athleteHeightM: 1.75 }),
    );
    const html = render({ skills: empty, records: [] });
    expect(html).toContain('No jump found in this video');
  });
});
