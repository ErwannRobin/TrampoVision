import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../analysis/computeAnalysis';
import { buildSession, type JumpLabel } from '../../coaching/session';
import { figureOf } from '../../dataset/movementLabel';
import { analyzeSkills } from '../../skills/analyzeSkills';
import { mannequinRoutine } from '../../skills/testMannequin';
import { Landing } from '../Landing';
import { SetupPanel, type SetupPanelProps } from '../rail/SetupPanel';
import { ElementPicker, nextMovement, twistName } from './ElementPicker';
import { LiveRail, groupJumps, type LiveRailProps } from './LiveRail';
import { subline } from './SkillCard';

/** A set: two bounces, a back tuck, a front pike, the back tuck again, and a quarter turn that can only be a guess. */
const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'straight' },
    { v0: 4.4, shape: 'straight' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.8, turns: 1, shape: 'pike' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.6, turns: 1.25, shape: 'straight' },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);
const session = (labels?: (JumpLabel | null)[]) => buildSession({ skills, result, twist: null, labels });

const rail = (over: Partial<LiveRailProps> = {}) =>
  renderToStaticMarkup(
    createElement(LiveRail, {
      session: session(),
      selected: 2,
      onSelect: () => {},
      onPlayJump: () => {},
      onConfirm: () => {},
      onPick: () => {},
      onOther: () => {},
      onClear: () => {},
      onDeduction: () => {},
      canLabel: true,
      onOpenSetup: () => {},
      onShowAdvanced: () => {},
      notes: [],
      title: 'clip',
      ...over,
    }),
  );

describe('the live rail', () => {
  it('shows the totals of the set and one row per skill, with its difficulty', () => {
    const html = rail();
    expect(html).toContain('3 skills');
    expect(html).toContain(', 1 to check');
    expect(html).toContain('Difficulty');
    expect(html).toContain('Execution');
    expect(html).toContain('In the air');
    expect(html).toContain('Copy summary');
    expect(html).toContain('Back somersault (tuck)');
    expect(html).toContain('Front somersault (pike)');
    expect(html).toContain('repeat, does not count');
  });

  it('folds the bounces into one line', () => {
    const html = rail();
    expect(html).toContain('2 straight jumps, 1 to 2');
    expect(html).not.toContain('>Straight jump</span>');
    // The bounce that is selected shows itself.
    expect(rail({ selected: 0 })).toContain('Straight jump');
  });

  it('opens the selected skill: is the guess right, how hard it is, what the pose earns, what to fix', () => {
    const html = rail({ selected: 3 });
    expect(html).toContain('Yes, that is it');
    expect(html).toContain('Change');
    expect(html).toContain('Difficulty');
    expect(html).toContain('Your deduction');
    expect(html).toContain('Not checked');
    // Only the selected skill is open.
    expect(html.match(/Your deduction/g)).toHaveLength(1);
  });

  it('says a skill is a guess, why, and offers to change it', () => {
    const html = rail({ selected: 5 });
    expect(html).toContain('Best guess, not counted yet');
    expect(html).toContain('Not counted until you check it');
    expect(html).toContain('live-row__unsure');
    expect(html).toContain('from the nearest whole somersault');
    expect(html).toContain('Change');
  });

  it('shows the coach’s label as theirs and offers to undo it', () => {
    const labelled = session([null, null, null, { elementId: 'front-1s-0t-tuck', other: false, deduction: 0.2 }]);
    const html = rail({ session: labelled, selected: 3 });
    expect(html).toContain('Your label');
    expect(html).toContain('Undo');
    expect(html).not.toContain('Yes, that is it');
    expect(html).toContain('aria-pressed="true"');
  });

  it('cannot save a label before the video is identified', () => {
    const html = rail({ canLabel: false, selected: 3 });
    expect(html).toContain('Labels can be saved once the video is identified');
    expect(html).toContain('disabled');
  });

  it('says so when there is nothing to score', () => {
    expect(rail({ session: { ...session(), jumps: [] } })).toContain('No jump found');
  });

  it('leads to the technical details', () => {
    expect(rail()).toContain('Show technical details');
  });
});

describe('the rows of the list', () => {
  it('groups the bounces that follow each other, and keeps the skills apart', () => {
    const items = groupJumps(session().jumps);
    expect(items.map((i) => i.kind)).toEqual(['bounces', 'skill', 'skill', 'skill', 'skill']);
    expect(items[0].kind === 'bounces' && items[0].jumps.map((j) => j.number)).toEqual([1, 2]);
  });

  it('says under the name how it was reached', () => {
    const jumps = session([null, null, null, { elementId: 'front-1s-0t-tuck', other: false, deduction: null }]).jumps;
    expect(subline(jumps[2])).toBe('');
    expect(subline(jumps[3])).toBe('Your label');
    expect(subline(jumps[4])).toContain('repeat, does not count');
    expect(subline(jumps[5])).toBe('Best guess, not counted yet');
  });
});

describe('choosing a skill part by part', () => {
  const back = { position: 'tuck', direction: 'back', somersaults: 1, halfTwists: 0 } as const;

  it('gives a back to a somersault that had none, and a straight position to a twisting jump', () => {
    expect(
      nextMovement({ position: 'tuck', direction: null, somersaults: 0, halfTwists: 0 }, { somersaults: 2 }),
    ).toEqual({
      position: 'tuck',
      direction: 'back',
      somersaults: 2,
      halfTwists: 0,
    });
    expect(
      nextMovement({ position: 'tuck', direction: null, somersaults: 0, halfTwists: 0 }, { halfTwists: 2 }),
    ).toMatchObject({
      position: 'straight',
      halfTwists: 2,
    });
  });

  it('drops the direction of a jump, and the twists a somersault count cannot carry', () => {
    expect(nextMovement(back, { somersaults: 0 }).direction).toBeNull();
    expect(nextMovement({ ...back, somersaults: 3, halfTwists: 4 }, { somersaults: 0 }).halfTwists).toBe(3);
  });

  it('always names an element of the table', () => {
    for (const patch of [
      { somersaults: 0 },
      { somersaults: 2 },
      { halfTwists: 3 },
      { direction: 'front' as const },
      { position: 'pike' as const },
    ])
      expect(figureOf(nextMovement(back, patch))).not.toBeNull();
  });

  it('says the twists as they are said', () => {
    expect([0, 1, 2, 3, 4, 5].map(twistName)).toEqual(['0', '½', '1', '1½', '2', '2½']);
  });

  it('starts from the element that is named', () => {
    const html = renderToStaticMarkup(
      createElement(ElementPicker, { element: session().jumps[3].element, onPick: () => {} }),
    );
    expect(html).toContain('Somersaults');
    expect(html).toContain('Direction');
    expect(html).toContain('Twists');
    expect(html).toContain('Position');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(4); // 1 somersault, front, no twist, pike
  });
});

describe('the first screen', () => {
  const dataset = {
    ready: true,
    kind: 'indexeddb',
    warning: null,
    error: null,
    records: [],
    save: async () => {},
    remove: async () => {},
    clear: async () => {},
    importText: async () => ({ added: 0, updated: 0, kept: 0 }),
  } as never;
  const landing = (advanced: boolean) =>
    renderToStaticMarkup(
      createElement(Landing, {
        onFile: () => {},
        onSample: () => {},
        onOpenSeries: () => {},
        dataset,
        busy: false,
        advanced,
      }),
    );

  it('asks for a video and nothing else in the live view', () => {
    const html = landing(false);
    expect(html).toContain('Score every skill.');
    expect(html).toContain('Choose a video');
    expect(html).toContain('Use the sample video');
    expect(html).not.toContain('Open a saved analysis');
  });

  it('brings back the saved analyses with the advanced tools', () => {
    expect(landing(true)).toContain('Open a saved analysis');
  });
});

describe('the settings', () => {
  const props = (advanced: boolean): SetupPanelProps => ({
    advanced,
    onAdvanced: () => {},
    hasVideo: true,
    hasResult: true,
    busy: 'idle',
    fileName: 'clip.mp4',
    model: 'full',
    onModel: () => {},
    numPoses: 1,
    onNumPoses: () => {},
    stride: 1,
    onStride: () => {},
    preferGpu: true,
    onPreferGpu: () => {},
    fps: 30,
    onFps: () => {},
    backend: '',
    webgpu: false,
    onAnalyze: () => {},
    onCancel: () => {},
    height: 1.75,
    onHeight: () => {},
    calibration: {
      corners: [],
      editing: false,
      bedLong: 4.28,
      bedShort: 2.14,
      firstSide: 'long',
      scaleSource: 'auto',
      status: '',
      error: false,
    },
    onEditCalibration: () => {},
    onUndoCorner: () => {},
    onClearCalibration: () => {},
    onBedLong: () => {},
    onBedShort: () => {},
    onFirstSide: () => {},
    onScaleSource: () => {},
    onSample: () => {},
    onOpenSeries: () => {},
    appearance: 'system',
    onAppearance: () => {},
  });

  it('keeps the athlete, the advanced switch and the appearance, and hides the engine and the trampoline', () => {
    const html = renderToStaticMarkup(createElement(SetupPanel, props(false)));
    expect(html).toContain('Athlete');
    expect(html).toContain('Show the advanced tools');
    expect(html).toContain('Appearance');
    for (const hidden of ['Trampoline', 'Model', 'Saved data', 'Video frame rate']) expect(html).not.toContain(hidden);
  });

  it('shows everything with the advanced tools on', () => {
    const html = renderToStaticMarkup(createElement(SetupPanel, props(true)));
    for (const shown of ['Trampoline', 'Model', 'Saved data', 'Video frame rate']) expect(html).toContain(shown);
  });
});
