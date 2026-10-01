/**
 * Minimal client for TypeSafe's Jev ("System One" decision model): typed questions over a piece of state, answered with probabilities.
 * https://docs.typesafe.ai/api.md
 *
 * Only measurements are ever sent (see `state.ts`), never a video or a frame. The app's browser build does not use this: its
 * local-only guard refuses cross-origin requests, and an API key must not ship in a bundle. It runs from Node (`scripts/jev-eval.ts`).
 */

export const JEV_BASE_URL = 'https://api.typesafe.ai/v1';
export const JEV_MODEL = 'jev-latest';

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** option -> what it means (max 255 options). */
  criteria: Record<string, string>;
}

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  /** Normalized over every option. */
  probabilities: Record<string, number>;
  /** How concentrated the distribution is, 0..1. */
  confidence: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Retries on 429 / 529, with exponential backoff. */
  retries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function jevSystemOne(
  request: { state: unknown; questions: Record<string, JevChoiceQuestion> },
  o: JevClientOptions,
): Promise<JevResponse> {
  const doFetch = o.fetch ?? fetch;
  const retries = o.retries ?? 3;
  const body = JSON.stringify({ model: o.model ?? JEV_MODEL, ...request });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${o.baseUrl ?? JEV_BASE_URL}/systemone`, {
        method: 'POST',
        headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep((o.backoffMs ?? 500) * 2 ** attempt);
        continue;
      }
      throw new JevError(`network: ${e instanceof Error ? e.message : String(e)}`, null);
    }
    if (res.ok) return (await res.json()) as JevResponse;
    if ((res.status === 429 || res.status === 529) && attempt < retries) {
      await sleep((o.backoffMs ?? 500) * 2 ** attempt);
      continue;
    }
    throw new JevError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  }
}
