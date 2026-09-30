import { analysisFingerprint } from '../dataset/record';
import { RECORD_SCHEMA, type JumpRecord } from '../dataset/types';

/**
 * Sharing the analyzed jumps with the review service. The browser stays the only classifier: each jump is posted with its measurements
 * and its prediction as soon as the analysis is done, and a reviewer corrects it afterwards. Nothing else leaves the browser: no video,
 * no file name, only numbers. Without a configured service (`VITE_REVIEW_API_URL`) the app is local-only, as before.
 */

export const REVIEW_API_URL: string | null =
  (import.meta.env.VITE_REVIEW_API_URL as string | undefined)?.replace(/\/+$/, '') || null;
const TOKEN = (import.meta.env.VITE_REVIEW_INGEST_TOKEN as string | undefined) || '';

/** The origin the page may call, for the runtime guard. */
export const REVIEW_API_ORIGIN: string | null = (() => {
  try {
    return REVIEW_API_URL ? new URL(REVIEW_API_URL).origin : null;
  } catch {
    return null;
  }
})();

export const BATCH = 25;
const SETTING_KEY = 'trampovision.reviewSync';

/** On unless the person turned it off. Storage can be blocked, then the default holds. */
export function readSyncSetting(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function writeSyncSetting(on: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    /* the choice lasts for this visit only */
  }
}

/** The record as it leaves the browser: the file name can name the athlete, so it stays here. */
export const forUpload = (r: JumpRecord): JumpRecord => ({ ...r, source: { ...r.source, fileName: '' } });

/** The records whose result the service has not seen yet. `sent` maps a record id to the fingerprint last posted. */
export function pendingRecords(records: readonly JumpRecord[], sent: ReadonlyMap<string, string>): JumpRecord[] {
  return records.filter((r) => r.schema === RECORD_SCHEMA && sent.get(r.id) !== analysisFingerprint(r));
}

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!REVIEW_API_URL) throw new Error('No review service configured');
  const res = await fetch(`${REVIEW_API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`Review service answered ${res.status}`);
  return res;
}

export async function postRecords(records: readonly JumpRecord[]): Promise<void> {
  await call('/jumps', { method: 'POST', body: JSON.stringify({ records: records.map(forUpload) }) });
}

/** The jumps the reviewers confirmed or corrected, as records with a figure (reference examples). */
export async function fetchReferenceRecords(): Promise<JumpRecord[]> {
  const body = (await (await call('/references')).json()) as { records?: JumpRecord[] };
  return (body.records ?? []).filter((r) => r.schema === RECORD_SCHEMA && r.figure && r.sequence);
}

/** What the person is told about the upload. */
export function syncStatusText(
  state: 'unavailable' | 'off' | 'idle' | 'sending' | 'sent' | 'failed',
  posted: number,
): string {
  switch (state) {
    case 'unavailable':
      return 'Nothing is uploaded.';
    case 'off':
      return 'Off. Nothing is uploaded.';
    case 'idle':
      return 'Waiting for an analysis.';
    case 'sending':
      return 'Sending…';
    case 'sent':
      return `${posted} ${posted === 1 ? 'jump' : 'jumps'} sent.`;
    case 'failed':
      return 'Could not reach the review service. Trying again in a moment.';
  }
}
