import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../../analysis/computeAnalysis';
import { analyzeSkills } from '../../../skills/analyzeSkills';
import { mannequinRoutine } from '../../../skills/testMannequin';
import { DASH, fmt } from '../../format';
import { jumpHeadline, type JumpHeadline } from '../../insights';
import { jumpFigures, SHAPE_WORD } from './figures';

const headline: JumpHeadline = {
  index: 0,
  number: 1,
  skill: 'tuck-jump',
  label: 'Tuck Jump',
  tier: 'high',
  confidence: 0.8,
  summary: '',
  complete: true,
  heightM: 3.416,
  heightReference: 'bed',
  riseM: 2.9,
  flightTimeS: 1.854,
  rotation: { turns: -1.02, totalDeg: -367, direction: 'counterclockwise' },
  bodyShape: 'tuck',
  bed: null,
  limitations: [],
};

const byKey = (h: JumpHeadline) => Object.fromEntries(jumpFigures(h).map((f) => [f.key, f]));

describe('jumpFigures', () => {
  it('shows the four figures of a complete jump', () => {
    const f = byKey(headline);
    expect(f.height).toMatchObject({ value: '3.42', unit: 'm', hint: 'above the bed', missing: false });
    expect(f.air).toMatchObject({ value: '1.85', unit: 's', hint: 'takeoff to landing' });
    expect(f.shape).toMatchObject({ value: 'Tuck', word: true, missing: false });
  });

  it('shows the size of a turn and says the direction in the hint', () => {
    expect(byKey(headline).rotation).toMatchObject({ value: '1.0', unit: 'turns', hint: 'counterclockwise on screen' });
    const clockwise = { ...headline, rotation: { turns: 0.5, totalDeg: 180, direction: 'clockwise' as const } };
    expect(byKey(clockwise).rotation).toMatchObject({ value: '0.5', hint: 'clockwise on screen' });
    const none = { ...headline, rotation: { turns: 0, totalDeg: 0, direction: 'none' as const } };
    expect(byKey(none).rotation).toMatchObject({ value: '0.0', hint: 'no rotation' });
  });

  it('says what zero height means', () => {
    expect(byKey({ ...headline, heightReference: 'lowest point' }).height.hint).toBe('above the lowest point');
  });

  it('dashes what a jump cut off by the clip does not have, and says why', () => {
    const cut: JumpHeadline = {
      ...headline,
      complete: false,
      flightTimeS: null,
      rotation: { turns: null, totalDeg: null, direction: 'none' },
      bodyShape: 'unknown',
    };
    const f = byKey(cut);
    for (const key of ['air', 'rotation', 'shape'] as const) {
      expect(f[key]).toMatchObject({ value: DASH, missing: true, hint: 'cut off by the clip' });
      expect(f[key].unit).toBeUndefined();
    }
    expect(f.height.missing).toBe(false); // the apex is always inside the clip
  });

  it('tells a body between shapes from a shape that was not measured', () => {
    const f = byKey({ ...headline, bodyShape: 'unknown' });
    expect(f.shape).toMatchObject({ value: SHAPE_WORD.unknown, hint: 'fits no shape well', missing: false });
  });

  it('never prints NaN when the scale could not be estimated', () => {
    const f = byKey({ ...headline, heightM: NaN });
    expect(f.height).toMatchObject({ value: DASH, hint: 'could not be measured', missing: true });
  });
});

describe('jumpFigures on a synthetic routine', () => {
  const { track } = mannequinRoutine({
    jumps: [
      { v0: 4.0, shape: 'straight' },
      { v0: 5.0, shape: 'tuck' },
    ],
    facing: 1,
  });
  const result = computeAnalysis(track, { athleteHeightM: 1.75 });
  const skills = analyzeSkills(result);

  it('reads every figure from the analysis, as the coach view does', () => {
    skills.jumps.forEach((j, i) => {
      const f = byKey(jumpHeadline(skills, result, i)!);
      expect(f.height.value).toBe(fmt(j.features.trajectory.maxHeightM, 2));
      expect(f.air.value).toBe(fmt(j.features.timing.flightTimeS, 2));
      expect(f.rotation.value).toBe(fmt(Math.abs(j.features.rotation.turns ?? NaN), 1));
      expect(f.shape.value).toBe(SHAPE_WORD[j.features.position.label]);
    });
  });
});
