import { readClips, type Filter } from './logic';

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
      headers: { authorization: `Bearer ${key}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
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
