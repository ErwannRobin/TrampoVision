import { readSeries } from '../video/bundle';
import { seriesCompletion, type Completion } from './completion';
import { readClips, type Clip, type Filter } from './logic';

/**
 * The calls of the moderation page. They take the owner's key (the Worker's REVIEW_TOKEN), typed by the owner and kept for this tab only:
 * unlike the app's token it is a secret, so it is never part of the build.
 */
const raw = (import.meta.env.VITE_REVIEW_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
export const API = raw || null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  if (!API) throw new ApiError('This build has no review service.', 0);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${key}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError('The service cannot be reached. Check the connection.', 0);
  }
  if (response.status === 401) throw new ApiError('This key is not accepted.', 401);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The service answered HTTP ${response.status}.`, response.status);
  }
  return response;
}

export async function listClips(key: string, filter: Filter) {
  const response = await call(`/admin/shares?filter=${filter}&limit=200`, key);
  return readClips(await response.json());
}

/** Lists a clip among the examples, or renames the listed one. */
export async function setLabel(key: string, id: string, label: string): Promise<string> {
  const response = await call(`/shares/${id}/example`, key, { method: 'PUT', body: JSON.stringify({ label }) });
  return ((await response.json()) as { label: string }).label;
}

export async function unlist(key: string, id: string): Promise<void> {
  await call(`/shares/${id}/example`, key, { method: 'DELETE' });
}

export async function remove(key: string, id: string): Promise<void> {
  await call(`/shares/${id}`, key, { method: 'DELETE' });
}

/** The clip as a local video address, to play it on the page (the build's CSP lets a video come from `blob:` only). */
export async function clipUrl(key: string, id: string): Promise<string> {
  const response = await call(`/shares/${id}`, key);
  return URL.createObjectURL(await response.blob());
}

/** Scores already worked out, by clip id. A shared clip never changes, so its score holds until the clip is gone. */
const SCORES_STORE = 'trampovision.moderationScores.v1';
const scores: Record<string, Completion | null> = (() => {
  try {
    return JSON.parse(localStorage.getItem(SCORES_STORE) ?? '{}') as Record<string, Completion | null>;
  } catch {
    return {};
  }
})();

/**
 * How much of the clip the app read well (see completion.ts), from the analysis inside it. Only the box headers and the analysis
 * box are downloaded, a few range requests: never the video. Null when the clip carries no analysis.
 */
export async function clipCompletion(key: string, clip: Pick<Clip, 'id' | 'size'>): Promise<Completion | null> {
  if (clip.id in scores) return scores[clip.id];
  const series = await readSeries({
    size: clip.size,
    read: async (start, end) => {
      const response = await call(`/shares/${clip.id}`, key, { headers: { range: `bytes=${start}-${end - 1}` } });
      if (response.status !== 206) {
        // The whole file is coming: stop it.
        void response.body?.cancel();
        throw new ApiError('The service does not send a part of a file.', response.status);
      }
      return response.blob();
    },
  });
  const score = series === null ? null : seriesCompletion(series);
  scores[clip.id] = score;
  try {
    localStorage.setItem(SCORES_STORE, JSON.stringify(scores));
  } catch {
    /* worked out again next time */
  }
  return score;
}
