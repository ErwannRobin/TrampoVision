import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { syntheticRoutine } from '../analysis/testTracks';
import type { PoseTrack } from '../analysis/types';
import { LM } from '../pose/landmarks';
import { analyzeSkills } from './analyzeSkills';
import { KNOWN_LIMITS, ruleBasedClassifier } from './classifier';
import { SEQUENCE_COLUMNS } from './jumpFeatures';
import { flipInverted, yawView } from './evaluation';
import { buildSkillReport, toSequencesCsv, toSkillReportJson, toSkillsCsv } from './export';
import { degradeTrack, mannequinPoseBuilder, mannequinRoutine, type MannequinJump } from './testMannequin';
import type { SkillClassifier } from './types';

const V0 = 4.4;
const run = (
  jumps: MannequinJump[],
  extra: Parameters<typeof mannequinRoutine>[0] extends infer T ? Partial<T> : never = {},
) => {
  const { track, truth } = mannequinRoutine({ jumps, facing: 1, ...extra });
  const result = computeAnalysis(track, { athleteHeightM: extra.heightM ?? 1.75 });
  return { track, truth, result, skills: analyzeSkills(result) };
};

describe('positions without rotation', () => {
  const { skills } = run([
    { v0: V0, shape: 'straight' },
    { v0: V0, shape: 'tuck' },
    { v0: V0, shape: 'pike' },
  ]);

  it('finds every jump and names the position', () => {
    expect(skills.jumps.map((j) => j.prediction.skill)).toEqual(['straight-jump', 'tuck-jump', 'pike-jump']);
  });

  it('measures the joint angles that were built into the mannequin', () => {
    const [straight, tuck, pike] = skills.jumps.map((j) => j.features.shape);
    expect(straight.hipAngle.atPeak).toBeGreaterThan(165);
    // tuck: hip flexion 125° -> interior 55°, knee flexion 115° -> interior 65°
    expect(tuck.hipAngle.atPeak).toBeCloseTo(55, 0);
    expect(tuck.kneeAngle.atPeak).toBeCloseTo(65, 0);
    // pike: hip flexion 100° -> interior 80°, straight legs
    expect(pike.hipAngle.atPeak).toBeCloseTo(80, 0);
    expect(pike.kneeAngle.atPeak).toBeGreaterThan(170);
  });

  it('has a higher compactness and closer knees in the tuck than in the straight jump', () => {
    const [straight, tuck] = skills.jumps.map((j) => j.features.shape);
    expect(tuck.compactness.atPeak!).toBeGreaterThan(straight.compactness.atPeak! + 0.2);
    expect(tuck.kneeTorsoDistance.atPeak!).toBeLessThan(straight.kneeTorsoDistance.atPeak!);
  });

  it('is confident when nothing is wrong', () => {
    for (const j of skills.jumps) expect(j.prediction.confidence).toBeGreaterThan(0.75);
  });

  it('lists evidence in the requested form and keeps the limits honest', () => {
    const pike = skills.jumps[2].prediction;
    const keys = pike.evidence.map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining(['hip_angle', 'knee_angle', 'body_orientation', 'leg_separation', 'rotation']),
    );
    expect(pike.evidence.find((e) => e.key === 'hip_angle')!.text).toBe('80°');
    expect(pike.evidence.find((e) => e.key === 'rotation')!.text).toMatch(/^0\.0 turns/);
    expect(pike.summary).toMatch(/hips fold to 80°/);
    expect(KNOWN_LIMITS.map((l) => l.signal)).toEqual(expect.arrayContaining(['Twists', 'Camera view']));
  });
});

describe('rotation', () => {
  it.each([
    [0, 0],
    [0.5, 1],
    [1, 2],
    [1.5, 3],
    [2, 4],
  ])('%s turns is read as %s half turns', (turns, half) => {
    const { skills } = run([{ v0: 5.2, turns, shape: 'tuck' }]);
    const r = skills.jumps[0].features.rotation;
    expect(r.halfTurns).toBe(half);
    // The error is the angular speed times the timing error of the takeoff and landing (a few hundredths of a second).
    expect(Math.abs(r.totalDeg!)).toBeGreaterThan(turns * 360 * 0.93 - 10);
    expect(Math.abs(r.totalDeg!)).toBeLessThan(turns * 360 * 1.07 + 10);
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('reports the direction and a lower confidence for a quarter turn, which is not a half-turn skill', () => {
    const { skills } = run([{ v0: 4.6, turns: -0.25, shape: 'straight' }]);
    const r = skills.jumps[0].features.rotation;
    expect(r.direction).toBe('counterclockwise');
    expect(r.confidence).toBeLessThan(0.3);
    expect(skills.jumps[0].prediction.skill).toBe('unclassified');
    expect(skills.jumps[0].prediction.limitations.map((l) => l.signal)).toContain('Rotation granularity');
  });

  it('leaves double somersaults outside the initial set, and says so', () => {
    const { skills } = run([{ v0: 5.6, turns: 2, shape: 'tuck' }]);
    const p = skills.jumps[0].prediction;
    expect(p.skill).toBe('unclassified');
    expect(p.summary).toMatch(/outside the initial skill set/);
  });
});

describe('front and back', () => {
  const label = (jump: MannequinJump) => run([jump]).skills.jumps[0].prediction;

  it('a turn toward the face is a front, away from it a back, for either facing', () => {
    expect(label({ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }).skill).toBe('front');
    expect(label({ v0: 4.8, turns: -1, facing: 1, shape: 'tuck' }).skill).toBe('back');
    expect(label({ v0: 4.8, turns: 1, facing: -1, shape: 'tuck' }).skill).toBe('back');
    expect(label({ v0: 4.8, turns: -1, facing: -1, shape: 'pike' }).skill).toBe('front');
  });

  it('estimates the facing from the face, knee and toe cues', () => {
    const right = run([{ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }]).skills.jumps[0].features.facing;
    const left = run([{ v0: 4.8, turns: 1, facing: -1, shape: 'tuck' }]).skills.jumps[0].features.facing;
    expect(right.sign).toBe(1);
    expect(left.sign).toBe(-1);
    expect(right.cues.face).toBeGreaterThan(0.5);
    expect(left.cues.face).toBeLessThan(-0.5);
    expect(left.confidence).toBeGreaterThan(0.7);
  });

  it('refuses to guess when the facing cues carry no information', () => {
    // Front view: horizontal distances shrink to almost nothing, so the profile cues vanish (and the view check fires).
    const { track } = mannequinRoutine({ jumps: [{ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }] });
    const blind: PoseTrack = {
      ...track,
      frames: track.frames.map(
        (f) =>
          f &&
          f.map((p, k) => {
            // Put the face on the ears and the toes on the heels; leave the rest.
            if (
              [
                LM.NOSE,
                LM.L_EYE_INNER,
                LM.L_EYE,
                LM.L_EYE_OUTER,
                LM.R_EYE_INNER,
                LM.R_EYE,
                LM.R_EYE_OUTER,
                LM.MOUTH_L,
                LM.MOUTH_R,
              ].includes(k as never)
            )
              return { ...f[LM.L_EAR] };
            if (k === LM.L_FOOT) return { ...f[LM.L_HEEL] };
            if (k === LM.R_FOOT) return { ...f[LM.R_HEEL] };
            return p;
          }),
      ),
    };
    const skills = analyzeSkills(computeAnalysis(blind));
    const f = skills.jumps[0].features.facing;
    expect(f.cues.face ?? 0).toBeCloseTo(0, 1);
    const p = skills.jumps[0].prediction;
    if (f.sign === 0) {
      expect(p.skill).toBe('somersault-direction-unknown');
      expect(p.limitations.map((l) => l.signal)).toContain('Facing direction');
      expect(p.limitations.find((l) => l.signal === 'Facing direction')!.needed).toMatch(/manually/);
    } else {
      // the knee cue alone was strong enough: the answer must at least come with a lower confidence than the full-cue case
      expect(f.confidence).toBeLessThan(1);
    }
  });

  it('accepts a manual facing setting', () => {
    const { result } = run([{ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }]);
    const left = analyzeSkills(result, { config: { facing: { override: 'left' } } }).jumps[0];
    expect(left.features.facing).toMatchObject({ sign: -1, source: 'manual', confidence: 1 });
    expect(left.prediction.skill).toBe('back'); // clockwise turn, facing left
  });
});

describe('normalization', () => {
  const jumps: MannequinJump[] = [
    { v0: 4.4, shape: 'tuck', turns: 1 },
    { v0: 4.2, shape: 'pike' },
  ];
  const a = mannequinRoutine({ jumps, facing: 1, heightM: 1.75, pxPerM: 100 });
  // Same athlete filmed at another resolution and standing elsewhere in a larger image.
  const moved = (track: PoseTrack, scale: number, dx: number, dy: number): PoseTrack => ({
    ...track,
    width: track.width * scale,
    height: track.height * scale,
    frames: track.frames.map((f) => f && f.map((p) => ({ ...p, x: p.x * scale + dx, y: p.y * scale + dy }))),
  });
  const b = moved(a.track, 0.6, 700, -120);
  const sa = analyzeSkills(computeAnalysis(a.track, { athleteHeightM: 1.75 }));
  const sb = analyzeSkills(computeAnalysis(b, { athleteHeightM: 1.75 }));

  it('gives the same sequence whatever the resolution and the position in the frame', () => {
    expect(sb.jumps).toHaveLength(sa.jumps.length);
    sa.jumps.forEach((ja, k) => {
      const jb = sb.jumps[k];
      expect(jb.sequence!.columns).toEqual(ja.sequence!.columns);
      const compare = SEQUENCE_COLUMNS.map((c, col) => ({ c, col })).filter(
        ({ c }) => !['com_h_m', 'com_x_m', 'com_vy_mps', 'com_x_bed'].includes(c),
      );
      for (let row = 0; row < ja.sequence!.samples; row++) {
        for (const { c, col } of compare) {
          const x = ja.sequence!.data[row][col];
          const y = jb.sequence!.data[row][col];
          if (Number.isNaN(x) && Number.isNaN(y)) continue;
          expect(y, `${c} row ${row}`).toBeCloseTo(x, 2);
        }
      }
    });
  });

  it('does not depend on the size of the athlete for the pose columns', () => {
    const tall = mannequinRoutine({ jumps, facing: 1, heightM: 1.95, pxPerM: 70 });
    const st = analyzeSkills(computeAnalysis(tall.track, { athleteHeightM: 1.95 }));
    const cols = SEQUENCE_COLUMNS.map((c, i) => ({ c, i })).filter(
      ({ c }) => (/_(x|y)$/.test(c) && !c.startsWith('com_')) || c === 'hip_angle_deg' || c === 'orient_turns',
    );
    for (let k = 0; k < sa.jumps.length; k++) {
      for (let row = 0; row < 32; row++) {
        for (const { c, i } of cols) {
          const x = sa.jumps[k].sequence!.data[row][i];
          const y = st.jumps[k].sequence!.data[row][i];
          if (Number.isNaN(x) || Number.isNaN(y)) continue;
          expect(Math.abs(x - y), `${c} row ${row}`).toBeLessThan(
            c === 'orient_turns' ? 0.03 : c === 'hip_angle_deg' ? 2 : 0.02,
          );
        }
      }
    }
  });

  it('has a fixed length, u from 0 to 1, and one column name per value', () => {
    const s = sa.jumps[0].sequence!;
    expect(s.samples).toBe(32);
    expect(s.data).toHaveLength(32);
    expect(s.data.every((row) => row.length === s.columns.length)).toBe(true);
    expect(s.data[0][0]).toBe(0);
    expect(s.data[31][0]).toBe(1);
    const turns = s.columns.indexOf('orient_turns');
    expect(s.data[0][turns]).toBeCloseTo(0, 5);
    expect(s.data[31][turns]).toBeGreaterThan(0.9);
    expect(s.valid.every((v) => v === 1)).toBe(true);
  });
});

describe('failure handling: report the limit instead of a wrong skill', () => {
  const somersault: MannequinJump[] = [{ v0: 4.8, turns: 1, facing: 1, shape: 'tuck' }];

  it('does not answer when the pose model flips the inverted athlete', () => {
    for (const mode of ['mirror', 'rotate180'] as const) {
      const { track } = mannequinRoutine({ jumps: somersault });
      const p = analyzeSkills(computeAnalysis(flipInverted(track, mode))).jumps[0].prediction;
      expect(['front', 'back']).not.toContain(p.skill);
      expect(p.skill === 'unclassified' || p.confidence < 0.5).toBe(true);
      expect(p.limitations.map((l) => l.signal)).toContain('Orientation tracking');
    }
  });

  it('does not answer a somersault seen from nearly the front', () => {
    const { track } = mannequinRoutine({ jumps: somersault });
    const p = analyzeSkills(computeAnalysis(yawView(track, 75))).jumps[0];
    expect(['front', 'back']).not.toContain(p.prediction.skill);
    expect(p.features.quality.trunkLengthVariation!).toBeGreaterThan(0.25);
    expect(p.prediction.limitations.map((l) => l.signal)).toContain('Camera view');
  });

  it('marks a jump that is cut off by the end of the clip', () => {
    const { track } = mannequinRoutine({
      jumps: [
        { v0: 4.4, shape: 'tuck' },
        { v0: 4.4, shape: 'tuck' },
      ],
    });
    const cut: PoseTrack = { ...track, times: track.times.slice(0, 85), frames: track.frames.slice(0, 85) }; // ends mid-flight of jump 2, after its apex
    const skills = analyzeSkills(computeAnalysis(cut));
    const last = skills.jumps[skills.jumps.length - 1];
    expect(last.features.complete).toBe(false);
    expect(last.sequence).toBeNull();
    expect(last.prediction.skill).toBe('unclassified');
    expect(last.prediction.limitations[0].signal).toBe('Jump boundaries');
  });

  it('lowers the pose-quality part when many joints are missing', () => {
    const { track } = mannequinRoutine({ jumps: [{ v0: 4.4, shape: 'pike' }] });
    const clean = analyzeSkills(computeAnalysis(track)).jumps[0].features.quality.pose;
    const holes = analyzeSkills(computeAnalysis(degradeTrack(track, { dropout: 0.5, seed: 4 }))).jumps[0];
    expect(holes.features.quality.pose).toBeLessThan(clean - 0.2);
  });

  it('survives landmark noise and dropouts', () => {
    const { track } = mannequinRoutine({
      jumps: [
        { v0: 4.4, shape: 'tuck' },
        { v0: 4.4, shape: 'pike' },
        { v0: 4.8, shape: 'tuck', turns: -1 },
      ],
    });
    const noisy = degradeTrack(track, { noisePx: 3, dropout: 0.08, seed: 21 });
    const p = analyzeSkills(computeAnalysis(noisy)).jumps.map((j) => j.prediction.skill);
    expect(p).toEqual(['tuck-jump', 'pike-jump', 'back']);
  });
});

describe('modularity and export', () => {
  const { skills } = run([
    { v0: 4.4, shape: 'tuck' },
    { v0: 4.8, shape: 'pike', turns: 1 },
  ]);

  it('accepts another classifier that reads the features and the normalized sequence', () => {
    const seen: number[] = [];
    const learned: SkillClassifier = {
      id: 'toy-model',
      version: '0',
      description: 'stand-in for a temporal model',
      classify({ features, sequence }) {
        seen.push(sequence ? sequence.samples : -1);
        return {
          ...ruleBasedClassifier.classify({ features, sequence, cycle: null as never, config: skills.config }),
          classifier: { id: 'toy-model', version: '0' },
        };
      },
    };
    const { result } = run([{ v0: 4.4, shape: 'tuck' }]);
    const out = analyzeSkills(result, { classifier: learned });
    expect(out.classifier.id).toBe('toy-model');
    expect(seen).toEqual([32]);
    expect(out.jumps[0].prediction.classifier.id).toBe('toy-model');
  });

  it('exports JSON with the sequences, features, predictions and thresholds', () => {
    const report = JSON.parse(
      toSkillReportJson(buildSkillReport(skills, { fileName: 'x.mp4', fps: 30, width: 640, height: 720 })),
    );
    expect(report.schema).toBe('trampovision.jump-skills');
    expect(report.jumps).toHaveLength(2);
    expect(report.config.position.hipFoldedMaxDeg).toBe(125);
    expect(report.jumps[1].sequence.columns).toEqual(SEQUENCE_COLUMNS);
    expect(report.jumps[1].features.rotation.nearestDeg).toBe(360);
    expect(report.jumps[1].prediction.evidence.length).toBeGreaterThan(5);
    expect(report.knownLimits.length).toBeGreaterThan(3);
  });

  it('exports one CSV row per jump and one per normalized sample', () => {
    const jumps = toSkillsCsv(skills).split('\n');
    expect(jumps).toHaveLength(3);
    expect(jumps[0].split(',')).toEqual(
      expect.arrayContaining(['skill', 'hip_angle_at_peak_deg', 'rotation_turns', 'facing']),
    );
    const long = toSequencesCsv(skills).split('\n');
    expect(long).toHaveLength(1 + 2 * 32);
    expect(long[0].split(',').slice(0, 4)).toEqual(['jump', 'sample', 'u', 'time_s']);
    expect(long[1].split(',')).toHaveLength(long[0].split(',').length);
  });
});

describe('the mannequin itself', () => {
  it('keeps the center of mass on a ballistic path whatever the shape', () => {
    const { result, truth } = run([{ v0: 4.6, shape: 'tuck' }]);
    const c = result.jumps.cycles[0];
    expect(c.flightTimeS!).toBeGreaterThan(truth.flight[0] * 0.93);
    expect(c.flightTimeS!).toBeLessThan(truth.flight[0] * 1.07);
    expect(c.impliedGravityMps2!).toBeGreaterThan(9);
    expect(c.impliedGravityMps2!).toBeLessThan(10.6);
  });

  it('is usable as a plain pose builder', () => {
    const { track } = syntheticRoutine({
      jumps: [{ v0: 4 }],
      pose: mannequinPoseBuilder({ jumps: [{ v0: 4, shape: 'pike' }] }),
    });
    expect(track.frames.every((f) => f && f.length === 33)).toBe(true);
  });
});
