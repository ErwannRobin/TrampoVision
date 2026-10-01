import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../analysis/computeAnalysis';
import { syncRecords } from '../../dataset/record';
import { inputOfRecord } from '../../eval/replay';
import { analyzeSkills } from '../analyzeSkills';
import { mergeSkillConfig } from '../config';
import { mannequinRoutine } from '../testMannequin';
import {
  QUESTIONS,
  classifyWithJev,
  formatJevDebug,
  outOfTable,
  rankElements,
  signalProblems,
  type QuestionId,
} from './classify';
import type { MovementSignature } from '../temporal/signature';
import { jevSystemOne, type JevChoiceAnswer } from './client';

const { track } = mannequinRoutine({ jumps: [{ v0: 4.8, turns: -1, shape: 'tuck', facing: 1 }], facing: 1 });
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const [record] = syncRecords([], {
  videoId: 'v',
  fileName: 'private-name.mov',
  result,
  skills: analyzeSkills(result),
  twist: null,
});
const input = inputOfRecord(record, mergeSkillConfig(), []);

const answer = (probabilities: Record<string, number>): JevChoiceAnswer => {
  const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] };
};
const backTuck: Record<QuestionId, JevChoiceAnswer> = {
  somersaults: answer({ '0': 0.02, '1': 0.95, '2': 0.02, '3': 0.01 }),
  twists: answer({ '0': 0.9, '0.5': 0.05, '1': 0.05 }),
  direction: answer({ front: 0.2, back: 0.8 }),
  position: answer({ straight: 0.05, tuck: 0.9, pike: 0.05 }),
};
const reply = (answers: unknown, status = 200) =>
  new Response(JSON.stringify({ model: 'jev-latest', answers, usage: { input_tokens: 700, output_tokens: 0 } }), {
    status,
  });

describe('rankElements', () => {
  it('ranks by the product of the four answers and gives a plausible runner-up', () => {
    const top = rankElements(backTuck);
    expect(top).toHaveLength(5);
    expect(top[0].elementId).toBe('back-1s-0t-tuck');
    expect(top[1].elementId).not.toBe(top[0].elementId);
    expect(top[0].probability).toBeGreaterThan(top[1].probability);
    expect(top.reduce((s, c) => s + c.probability, 0)).toBeLessThanOrEqual(1.0000001);
  });

  it('ignores the direction of a jump without somersault', () => {
    const jump = { ...backTuck, somersaults: answer({ '0': 1, '1': 0 }), direction: answer({ front: 1, back: 0 }) };
    expect(rankElements(jump)[0].elementId).toBe('none-0s-0t-tuck');
  });
});

const sigOf = (channels: Partial<Record<'somersault' | 'comHeight', number[]>>) =>
  ({
    channels: { somersault: [0, 0], comHeight: [0, 0], ...channels },
    trust: { somersault: 1, comHeight: 1 },
  }) as unknown as MovementSignature;

describe('signalProblems', () => {
  it('accepts a clean jump and a somersault', () => {
    expect(signalProblems(sigOf({ comHeight: [0, 0.6, 1, 0.6, -0.1], somersault: [0, 0.3, 0.6, 0.9, 1] }))).toEqual([]);
  });

  it('doubts a height far below takeoff and a rotation that runs back', () => {
    expect(signalProblems(sigOf({ comHeight: [0, 1, 0.2, -1, -3.4] }))).toHaveLength(1);
    expect(signalProblems(sigOf({ somersault: [0, 0.7, 1.55, 1.27, 1.41] }))).toHaveLength(1);
    expect(signalProblems(sigOf({ somersault: [0, -0.7, -1.55, -1.27, -1.41] }))).toHaveLength(1);
  });

  it('does not take the wobble of a jump without somersault for a broken curve', () => {
    expect(signalProblems(sigOf({ somersault: [0, 0.2, 0.05, 0.1, 0.05] }))).toEqual([]);
  });
});

describe('outOfTable', () => {
  it('names the combination when it is no FIG element, and says nothing when it is one', () => {
    expect(
      outOfTable({
        ...backTuck,
        somersaults: answer({ '0': 1 }),
        twists: answer({ '0.5': 1 }),
        position: answer({ pike: 1 }),
      }),
    ).toBe('0 somersaults, 0.5 twists, pike');
    expect(outOfTable(backTuck)).toBeNull();
  });

  it('gives a low confidence to the closest element instead of a share of what is left', async () => {
    const off = {
      ...backTuck,
      somersaults: answer({ '0': 1 }),
      twists: answer({ '0.5': 1 }),
      position: answer({ pike: 1 }),
    };
    const r = await classifyWithJev(input, { client: { apiKey: 'k', fetch: async () => reply(off) } });
    expect(r.outOfTable).toContain('pike');
    expect(r.candidates[0].mass).toBeLessThan(0.1);
    expect(r.final.confidence).toBeLessThan(0.1);
    expect(r.reason).toContain('no FIG element');
  });
});

describe('classifyWithJev', () => {
  it('names the element from Jev and sends measurements only', async () => {
    let sent = '';
    const r = await classifyWithJev(input, {
      client: {
        apiKey: 'k',
        fetch: async (_url, init) => {
          sent = String(init?.body);
          return reply(backTuck);
        },
      },
    });
    expect(r.status).toBe('ok');
    expect(r.final).toMatchObject({ elementId: 'back-1s-0t-tuck', source: 'jev' });
    expect(r.candidates).toHaveLength(5);
    expect(r.problems).toEqual([]);
    const body = JSON.parse(sent);
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    expect(Object.keys(body.questions)).toEqual(Object.keys(QUESTIONS));
    expect(sent).not.toContain('private-name');
    expect(sent).not.toMatch(/data:|blob:|\.mov/);
    expect(body.state.trajectories.somersault).toHaveLength(9);
    const debug = formatJevDebug(r);
    for (const part of ['MovementSignature', 'Top 5 (Jev)', 'Top 5 (local)', 'Reason:', 'Final: back-1s-0t-tuck']) {
      expect(debug).toContain(part);
    }
  });

  it('falls back to the local classifier when Jev fails, never throws', async () => {
    for (const failing of [
      async () => reply({}, 500),
      async () => {
        throw new Error('offline');
      },
      async () => reply({ somersaults: backTuck.somersaults }),
    ]) {
      const r = await classifyWithJev(input, { client: { apiKey: 'k', fetch: failing, retries: 0 } });
      expect(r.status).toBe('unavailable');
      expect(r.final.source).toBe('local');
      expect(r.final.elementId).toBe(r.local.elementId);
    }
  });

  it('runs the local classifier alone without a client', async () => {
    const r = await classifyWithJev(input, { client: null });
    expect(r.status).toBe('unavailable');
    expect(r.final.source).toBe('local');
  });
});

describe('jevSystemOne', () => {
  it('retries on 429 and does not retry a 401', async () => {
    let calls = 0;
    const ok = await jevSystemOne(
      { state: {}, questions: QUESTIONS },
      { apiKey: 'k', backoffMs: 1, fetch: async () => (++calls < 3 ? reply({}, 429) : reply(backTuck)) },
    );
    expect(calls).toBe(3);
    expect(ok.answers.position.choice).toBe('tuck');
    calls = 0;
    await expect(
      jevSystemOne(
        { state: {}, questions: QUESTIONS },
        { apiKey: 'k', backoffMs: 1, fetch: async () => (calls++, reply({}, 401)) },
      ),
    ).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });
});
