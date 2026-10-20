import { t } from '../i18n/core';
import { fetchWithProgress } from '../video/sample';
import { REVIEW_API_URL } from './reviewSync';

/**
 * Shared clips. "Share link" uploads the clip with its analysis inside (src/video/bundle.ts) to the review Worker, which keeps it in R2
 * for SHARE_DAYS (worker/src/shares.ts), and gives a link that opens it, already analyzed, in anyone's browser. This is the one case
 * where the video leaves the browser: only when the person asks for a link, after the dialog says where it goes and for how long.
 * The Worker's origin is the review service's, so the Content-Security-Policy and the local-only guard need nothing more. Without a
 * review service (`VITE_REVIEW_API_URL`) there is no sharing.
 *
 * Right after the upload the dialog suggests listing the clip among the examples of the first screen. A listed clip is kept for good
 * (until its uploader stops sharing it) and everyone sees it in the menu; that is asked for separately, with its own words.
 */

export const SHARE_API_URL = REVIEW_API_URL;
export const canShare = SHARE_API_URL !== null;
const TOKEN = (import.meta.env.VITE_REVIEW_INGEST_TOKEN as string | undefined) || '';

/** How long a shared clip stays, as the Worker keeps it. */
export const SHARE_DAYS = 90;
/** The largest clip the Worker accepts. */
export const MAX_SHARE_BYTES = 100_000_000;
/** The longest name of a listed clip, as the Worker keeps it. */
export const MAX_EXAMPLE_LABEL = 60;

/** What the Worker answers to an upload. `deleteKey` is the only way to remove the clip before it expires. */
export interface ShareReceipt {
  id: string;
  expiresAt: string;
  deleteKey: string;
}

const SHARE_PARAM = 'share';
const ID = /^[A-Za-z0-9_-]{22}$/;

/** The address that opens a shared clip in the app. */
export function shareLink(id: string, page = `${location.origin}${location.pathname}`): string {
  return `${page}?${SHARE_PARAM}=${id}`;
}

/** The id of the shared clip the address (`location.search`) asks for, or null. */
export function shareIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get(SHARE_PARAM);
  return id && ID.test(id) ? id : null;
}

/** The query string without the shared clip. */
export function withoutShare(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHARE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** A clip listed among the examples of the first screen. */
export interface Example {
  id: string;
  label: string;
}

/** A refusal of the Worker in words. */
export function shareErrorText(status: number): string {
  if (status === 413) return t('share.errTooLarge', { mb: MAX_SHARE_BYTES / 1e6 });
  if (status === 429) return t('share.errTooMany');
  if (status === 503) return t('share.errFull');
  if (status === 415) return t('share.errType');
  if (status === 0) return t('share.errNetwork');
  return t('share.errHttp', { status });
}

/**
 * Uploads a clip with its analysis inside. XMLHttpRequest rather than fetch: it says how much of the file has gone (0..1).
 * Rejects with a readable Error, or an AbortError when `signal` aborts.
 */
export function uploadShare(
  file: Blob,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ShareReceipt> {
  return new Promise((resolve, reject) => {
    if (!SHARE_API_URL) return reject(new Error(t('share.unavailable')));
    if (file.size > MAX_SHARE_BYTES) return reject(new Error(shareErrorText(413)));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SHARE_API_URL}/shares`);
    xhr.setRequestHeader('authorization', `Bearer ${TOKEN}`);
    xhr.setRequestHeader('content-type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status !== 201) return reject(new Error(shareErrorText(xhr.status)));
      try {
        const body = JSON.parse(xhr.responseText) as Partial<ShareReceipt>;
        if (typeof body.id !== 'string' || !ID.test(body.id) || typeof body.deleteKey !== 'string') throw new Error();
        resolve({ id: body.id, expiresAt: String(body.expiresAt ?? ''), deleteKey: body.deleteKey });
      } catch {
        reject(new Error(shareErrorText(xhr.status)));
      }
    };
    xhr.onerror = () => reject(new Error(shareErrorText(0)));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Downloads a shared clip (the video with its analysis inside). Throws a readable Error when it is gone or cannot be read. */
export async function downloadShare(id: string, onProgress?: (fraction: number) => void): Promise<File> {
  if (!SHARE_API_URL) throw new Error(t('share.unavailable'));
  let download;
  try {
    download = await fetchWithProgress(`${SHARE_API_URL}/shares/${id}`, onProgress);
  } catch {
    throw new Error(shareErrorText(0));
  }
  if (download.status === 404) throw new Error(t('share.errGone'));
  if (!download.ok) throw new Error(shareErrorText(download.status));
  const type = download.blob.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  return new File([download.blob], `trampovision-${id}.${type === 'video/quicktime' ? 'mov' : 'mp4'}`, { type });
}

/** The clips listed among the examples, newest first. Empty without a sharing service, or when it cannot be reached or read. */
export async function fetchExamples(): Promise<Example[]> {
  if (!SHARE_API_URL) return [];
  try {
    const response = await fetch(`${SHARE_API_URL}/examples`);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const list = body && typeof body === 'object' ? (body as { examples?: unknown }).examples : null;
    return Array.isArray(list) ? list.flatMap(exampleOf) : [];
  } catch {
    return [];
  }
}

function exampleOf(raw: unknown): Example[] {
  const e = raw as Partial<Example> | null;
  return e && typeof e.id === 'string' && ID.test(e.id) && typeof e.label === 'string' && e.label.trim()
    ? [{ id: e.id, label: e.label.trim() }]
    : [];
}

/** Lists a shared clip among the examples, under `label`, for good. Takes the key the upload gave. */
export async function listExample(id: string, deleteKey: string, label: string): Promise<void> {
  if (!SHARE_API_URL) throw new Error(t('share.unavailable'));
  let response: Response;
  try {
    response = await fetch(`${SHARE_API_URL}/shares/${id}/example`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${deleteKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  } catch {
    throw new Error(shareErrorText(0));
  }
  if (response.status === 404) throw new Error(t('share.errGone'));
  if (response.status === 503) throw new Error(t('share.errExamplesFull'));
  if (!response.ok) throw new Error(shareErrorText(response.status));
}

/** Removes a shared clip: the link no longer opens it. */
export async function deleteShare(id: string, deleteKey: string): Promise<void> {
  if (!SHARE_API_URL) throw new Error(t('share.unavailable'));
  let response: Response;
  try {
    response = await fetch(`${SHARE_API_URL}/shares/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${deleteKey}` },
    });
  } catch {
    throw new Error(shareErrorText(0));
  }
  // Already gone (expired, or removed from another tab) is what was asked.
  if (!response.ok && response.status !== 404) throw new Error(shareErrorText(response.status));
}

/**
 * The links made on this device, by clip id, so that sharing the same clip again shows its link (and the way to remove it) instead of
 * uploading it once more. A clip opened from a link is kept too, without a delete key.
 */
export interface StoredShare {
  id: string;
  /** When the Worker deletes the clip; empty for a listed clip, which stays until it is stopped. */
  expiresAt: string;
  deleteKey?: string;
  /** The clip is listed among the examples. */
  listed?: boolean;
}

const STORE_KEY = 'trampovision.shares';

function readStore(): Record<string, StoredShare> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, StoredShare>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, StoredShare>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* the link lasts for this visit only */
  }
}

const expired = (s: StoredShare, now: number) => !!s.expiresAt && Date.parse(s.expiresAt) <= now;

/** The link of this clip, when one was made or opened on this device and has not expired. */
export function rememberedShare(clipId: string, now = Date.now()): StoredShare | null {
  const s = readStore()[clipId];
  return s && typeof s.id === 'string' && ID.test(s.id) && !expired(s, now) ? s : null;
}

export function rememberShare(clipId: string, share: StoredShare, now = Date.now()) {
  const store = readStore();
  for (const [k, s] of Object.entries(store)) if (expired(s, now)) delete store[k];
  store[clipId] = share;
  writeStore(store);
}

export function forgetShare(clipId: string) {
  const store = readStore();
  delete store[clipId];
  writeStore(store);
}
