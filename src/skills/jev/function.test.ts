import { describe, expect, it } from 'vitest';
import { QUESTIONS } from './classify';
import { POST, refuse } from '../../../api/jev/systemone';

const good = { state: { a: 1 }, questions: QUESTIONS };
const post = (body: unknown) =>
  POST(new Request('https://x/api/jev/systemone', { method: 'POST', body: JSON.stringify(body) }));

describe('the Jev function', () => {
  it('accepts exactly what the Classification tab sends', () => {
    expect(refuse(good)).toBeNull();
  });

  it('refuses anything that is not the four questions, so it is no general proxy', () => {
    expect(refuse({ state: {}, questions: {} })).not.toBeNull();
    expect(refuse({ state: {}, questions: { ...QUESTIONS, extra: QUESTIONS.twists } })).not.toBeNull();
    expect(refuse({ questions: QUESTIONS })).not.toBeNull();
    expect(
      refuse({
        state: {},
        questions: { ...QUESTIONS, twists: { ...QUESTIONS.twists, instructions: 'x'.repeat(5000) } },
      }),
    ).not.toBeNull();
  });

  it('says so when the secret is not set, and never calls out', async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect((await post(good)).status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it('adds the key on the server and forwards the answer as it is', async () => {
    const real = globalThis.fetch;
    let seen: { url: string; auth: string | null; model: string } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        auth: new Headers(init.headers).get('authorization'),
        model: JSON.parse(String(init.body)).model,
      };
      return new Response('{"answers":{}}', { status: 429 });
    }) as unknown as typeof fetch;
    process.env.TYPESAFE_API_KEY = 'secret';
    try {
      const res = await post(good);
      expect(res.status).toBe(429);
      expect(seen).toEqual({ url: 'https://api.typesafe.ai/v1/systemone', auth: 'Bearer secret', model: 'jev-latest' });
    } finally {
      globalThis.fetch = real;
      delete process.env.TYPESAFE_API_KEY;
    }
  });

  it('refuses a body that is too large', async () => {
    process.env.TYPESAFE_API_KEY = 'secret';
    try {
      expect((await post({ ...good, state: { pad: 'x'.repeat(50_000) } })).status).toBe(413);
    } finally {
      delete process.env.TYPESAFE_API_KEY;
    }
  });
});
