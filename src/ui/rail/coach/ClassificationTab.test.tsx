import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../../analysis/computeAnalysis';
import { analyzeSkills } from '../../../skills/analyzeSkills';
import { classifyWithJev, type QuestionId } from '../../../skills/jev/classify';
import type { JevChoiceAnswer } from '../../../skills/jev/client';
import { mannequinRoutine } from '../../../skills/testMannequin';
import { ClassificationTab } from './ClassificationTab';
import { compareLines, partsOfElement } from './jevCompare';

const { track } = mannequinRoutine({ jumps: [{ v0: 4.8, turns: -1, shape: 'tuck', facing: 1 }], facing: 1 });
const result = computeAnalysis(track, { athleteHeightM: 1.75 });
const skills = analyzeSkills(result);

const answer = (probabilities: Record<string, number>): JevChoiceAnswer => {
  const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] };
};
const answers: Record<QuestionId, JevChoiceAnswer> = {
  somersaults: answer({ '0': 0.02, '1': 0.95, '2': 0.02, '3': 0.01 }),
  twists: answer({ '0': 0.9, '0.5': 0.05, '1': 0.05 }),
  direction: answer({ front: 0.2, back: 0.8 }),
  position: answer({ straight: 0.05, tuck: 0.9, pike: 0.05 }),
};
const fetchOk = (async () =>
  new Response(
    JSON.stringify({ model: 'jev-latest', answers, usage: { input_tokens: 700, output_tokens: 0 } }),
  )) as typeof fetch;

describe('the classification tab', () => {
  it('keeps the input the classifier was given, to ask Jev about the same jump', () => {
    expect(skills.jumps[0].input?.features).toBe(skills.jumps[0].features);
  });

  it('asks nothing while it is only shown: it offers the button and says nothing was sent', () => {
    let calls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (() => {
      calls++;
      return Promise.reject(new Error('no network in a render'));
    }) as typeof fetch;
    try {
      const html = renderToStaticMarkup(createElement(ClassificationTab, { skills, selected: 0 }));
      expect(html).toContain('<button');
      expect(html).toContain('disabled');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('puts the two answers side by side, part by part', async () => {
    const input = skills.jumps[0].input!;
    const r = await classifyWithJev(input, { client: { apiKey: 'k', fetch: fetchOk } });
    const { parts, top, agree } = compareLines(r);
    expect(parts.map((p) => p.key)).toEqual(['somersaults', 'twists', 'direction', 'position']);
    expect(parts.find((p) => p.key === 'position')?.jev).toMatch(/^tuck/);
    expect(top).toHaveLength(5);
    expect(agree).toBe(r.local.elementId === r.jevElementId);
  });

  it('says nothing about agreement when Jev did not answer', async () => {
    const r = await classifyWithJev(skills.jumps[0].input!, { client: null });
    expect(compareLines(r).agree).toBeNull();
    expect(compareLines(r).parts.every((p) => p.jev === '–')).toBe(true);
  });

  it('reads the parts of an element', () => {
    expect(partsOfElement('none-0s-0t-tuck')).toEqual({
      somersaults: '0',
      twists: '0',
      direction: 'none',
      position: 'tuck',
    });
    expect(partsOfElement('nope')).toBeNull();
  });
});
