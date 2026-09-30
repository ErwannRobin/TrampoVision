import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { buildPoseSeries, parsePoseSeries, toSeriesJson } from '../analysis/timeSeries';
import { buildSession, type JumpLabel } from '../coaching/session';
import { analyzeSkills } from '../skills/analyzeSkills';
import { mannequinRoutine } from '../skills/testMannequin';
import { createMemoryHistory } from './store';

/** A bounce, a tuck jump, a back tuck and a jump the classifier can only guess at: a set with a guess that waits for a check. */
const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.2, shape: 'straight' },
    { v0: 4.4, shape: 'tuck' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.6, turns: 1.25, shape: 'straight' },
  ],
  facing: 1,
});

const HEIGHT = 1.78;
const analyze = (t: typeof track, height: number, labels?: (JumpLabel | null)[]) => {
  const result = computeAnalysis(t, { athleteHeightM: height });
  const skills = analyzeSkills(result);
  return { result, skills, session: buildSession({ skills, result, twist: null, labels }) };
};

/** What the first screen and the live view say about a set. */
const figures = (s: ReturnType<typeof analyze>['session']) => ({
  skills: s.summary.skills,
  pending: s.summary.pending,
  difficulty: s.summary.difficulty,
  bounces: s.summary.bounces,
  cutOff: s.summary.cutOff,
  judged: s.summary.judged,
  names: s.jumps.map((j) => j.element?.id ?? null),
  sources: s.jumps.map((j) => j.source),
});

/** Saves a set the way the app does, reads it back from the store and analyzes it again the way opening a saved analysis does. */
async function roundTrip(labels?: (JumpLabel | null)[]) {
  const live = analyze(track, HEIGHT, labels);
  const series = toSeriesJson(
    buildPoseSeries(live.result, track, {
      fileName: 'IMG_8368.mp4',
      videoId: 'v-abc',
      stride: 1,
      minVisibility: 0.4,
      calibration: null,
    }),
  );
  const store = createMemoryHistory();
  await store.put({
    id: 'v-abc',
    fileName: 'IMG_8368.mp4',
    savedAt: new Date().toISOString(),
    skills: live.session.summary.skills,
    pending: live.session.summary.pending,
    difficulty: live.session.summary.difficulty,
    jumps: live.session.jumps.length,
    series,
  });
  const stored = (await store.get('v-abc'))!;
  const parsed = parsePoseSeries(stored.series);
  const reopened = analyze(parsed.track, parsed.settings.athleteHeightM, labels);
  return { live, stored, parsed, reopened };
}

describe('a set that is saved and opened again', () => {
  it('is the same file as "Save analysis": parsePoseSeries reads it, and the settings come back', async () => {
    const { stored, parsed } = await roundTrip();
    expect(JSON.parse(stored.series)).toMatchObject({
      schema: 'trampovision.pose-series',
      source: { videoId: 'v-abc' },
    });
    expect(parsed.source.fileName).toBe('IMG_8368.mp4');
    expect(parsed.settings.athleteHeightM).toBe(HEIGHT);
    expect(parsed.track.frames).toHaveLength(track.frames.length);
  });

  it('gives the same set: the skills, the difficulty and the guesses that wait for a check', async () => {
    const { live, reopened } = await roundTrip();
    expect(live.session.summary.pending).toBe(1);
    expect(live.session.summary.skills).toBe(2);
    expect(figures(reopened.session)).toEqual(figures(live.session));
    expect(reopened.session.summary.difficulty).toBe(live.session.summary.difficulty);
  });

  it('keeps the corrections: the labels of the coach apply to the reopened set the same way', async () => {
    const guess = analyze(track, HEIGHT).session.jumps[3].element!.id;
    const labels: (JumpLabel | null)[] = [
      null,
      null,
      { elementId: null, other: false, deduction: 0.3 },
      { elementId: guess, other: false, deduction: null },
    ];
    const { live, reopened } = await roundTrip(labels);
    expect(live.session.summary.pending).toBe(0);
    expect(live.session.summary.skills).toBe(3);
    expect(figures(reopened.session)).toEqual(figures(live.session));
    expect(reopened.session.jumps[2].coachDeduction).toBe(0.3);
    expect(reopened.session.jumps[3].source).toBe('coach');
    expect(reopened.session.summary.execution).toBeCloseTo(live.session.summary.execution!, 1);
  });

  it('keeps the figures the list shows equal to the ones the live view shows', async () => {
    const { live, stored, reopened } = await roundTrip();
    expect(stored.skills).toBe(reopened.session.summary.skills);
    expect(stored.pending).toBe(reopened.session.summary.pending);
    expect(stored.difficulty).toBe(reopened.session.summary.difficulty);
    expect(stored.jumps).toBe(live.session.jumps.length);
  });
});
