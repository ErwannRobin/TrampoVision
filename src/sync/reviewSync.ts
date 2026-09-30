import { t, tp } from '../i18n/core';
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

/** What the person says about a jump: it was the figure the classifier named, it was another one, or it cannot be told. */
export type Verdict = { verdict: 'confirm' } | { verdict: 'correct'; elementId: string } | { verdict: 'unknown' };

/** The verdict a saved record carries, or null when the person only gave an execution score (or nothing). */
export function verdictOf(r: JumpRecord): Verdict | null {
  if (r.figure) {
    return r.figure.elementId === r.prediction.elementId
      ? { verdict: 'confirm' }
      : { verdict: 'correct', elementId: r.figure.elementId };
  }
  return r.truth?.label === 'unknown' ? { verdict: 'unknown' } : null;
}

/** Who says it: the live view of the app, as opposed to a person on the reviewer page. */
const REVIEWER = 'live';

/** Sends what the person said about a jump: the record first (the service may not have it yet, and it carries the execution score), then the verdict. */
export async function sendVerdict(record: JumpRecord): Promise<void> {
  await postRecords([record]);
  const v = verdictOf(record);
  if (v)
    await call(`/jumps/${encodeURIComponent(record.id)}/review`, {
      method: 'PUT',
      body: JSON.stringify({ ...v, reviewer: REVIEWER }),
    });
}

/** The jumps the reviewers confirmed or corrected, as records with a figure (reference examples). */
export async function fetchReferenceRecords(): Promise<JumpRecord[]> {
  const body = (await (await call('/references')).json()) as { records?: JumpRecord[] };
  return (body.records ?? []).filter((r) => r.schema === RECORD_SCHEMA && r.figure && r.sequence);
}

/** How many jumps wait for a reviewer, or null when the service cannot be reached. */
export async function fetchQueueCount(): Promise<number | null> {
  try {
    const body = (await (await call('/stats')).json()) as { stats?: { status: string; n: number }[] };
    return body.stats?.find((s) => s.status === 'auto')?.n ?? 0;
  } catch {
    return null;
  }
}

const OUTBOX_KEY = 'trampovision.verdictOutbox';
/** Records that wait to be sent are remembered by id (the record itself is in the local dataset). The oldest go first if there are too many. */
export const OUTBOX_MAX = 200;

export function readOutbox(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-OUTBOX_MAX) : [];
  } catch {
    return [];
  }
}
export function writeOutbox(ids: readonly string[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ids.slice(-OUTBOX_MAX)));
  } catch {
    /* they are sent while the page stays open, and lost when it closes */
  }
}

/** What the person is told about the upload. */
export function syncStatusText(
  state: 'unavailable' | 'off' | 'idle' | 'sending' | 'sent' | 'failed',
  posted: number,
): string {
  switch (state) {
    case 'unavailable':
      return t('sync.unavailable');
    case 'off':
      return t('sync.off');
    case 'idle':
      return t('sync.idle');
    case 'sending':
      return t('sync.sending');
    case 'sent':
      return tp('sync.sent', posted);
    case 'failed':
      return t('sync.failed');
  }
}
