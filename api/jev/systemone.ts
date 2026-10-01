/// <reference types="node" />
/**
 * Vercel function: the browser's way to Jev without the key. The key (TYPESAFE_API_KEY, a secret of the Vercel project) stays here;
 * the Classification tab calls `${VITE_JEV_API_URL}/systemone`, set to `/api/jev`, so the call is same-origin.
 *
 * It is a public URL, so it is not a generic proxy: POST only, the model is fixed here, the body is small, and the questions must
 * be the four of `src/skills/jev/classify.ts` (somersaults, twists, direction, position). Self-contained on purpose: no import
 * from `src/`, so the function builds on its own.
 */
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const MAX_BODY_BYTES = 40_000;
const QUESTION_IDS = ['direction', 'position', 'somersaults', 'twists'];
const MAX_OPTIONS = 20;
const MAX_TEXT = 3_000;

export const maxDuration = 30;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why the request is not one the Classification tab would send, or null. */
export function refuse(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.state) || !isRecord(body.questions)) return 'expected { state, questions }';
  if (Object.keys(body.questions).sort().join() !== QUESTION_IDS.join()) return 'unknown questions';
  for (const q of Object.values(body.questions)) {
    if (!isRecord(q) || q.type !== 'choice' || typeof q.instructions !== 'string' || !isRecord(q.criteria))
      return 'malformed question';
    const options = Object.entries(q.criteria);
    if (options.length > MAX_OPTIONS || q.instructions.length > MAX_TEXT) return 'question too large';
    if (options.some(([, text]) => typeof text !== 'string' || text.length > MAX_TEXT)) return 'malformed question';
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return reply(503, { error: 'TYPESAFE_API_KEY is not set on this deployment' });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply(413, { error: 'request too large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'not JSON' });
  }
  const why = refuse(body);
  if (why) return reply(400, { error: why });
  const { state, questions } = body as { state: unknown; questions: unknown };
  try {
    const res = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: AbortSignal.timeout(25_000),
    });
    // Status and body go back as they are, so the client's retry on 429 / 529 still works.
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return reply(502, { error: `Jev unreachable: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export function GET(): Response {
  return reply(405, { error: 'POST only' });
}
