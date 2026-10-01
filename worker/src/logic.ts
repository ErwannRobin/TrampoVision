import { elementById } from '../../src/skills/fig/elements';

/** The pure part of the Worker: validation and row building, so it can be tested without a database. */

export const MAX_RECORDS_PER_POST = 25;
export const MAX_RECORD_BYTES = 400_000;

export const STATUSES = ['auto', 'confirmed', 'corrected', 'unknown', 'bad-data'] as const;
export type Status = (typeof STATUSES)[number];
export const VERDICTS = ['confirm', 'correct', 'unknown', 'bad-data'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface JumpRow {
  id: string;
  video_id: string;
  jump_id: number;
  auto_skill: string;
  auto_element_id: string | null;
  auto_certainty: string | null;
  auto_confidence: number;
  classifier: string;
  fingerprint: string;
  record: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** FNV-1a over the measurements and the prediction: the same result gives the same fingerprint, whatever else changed. */
export function fingerprint(r: Obj): string {
  const text = JSON.stringify([r.timestamps, r.features, r.prediction, isObj(r.twist) ? r.twist.estimate : null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** One record of the browser (a JumpRecord) as a row. Only the fields the queue needs are read; the rest is kept as sent. */
export function rowOf(raw: unknown): Parsed<JumpRow> {
  if (!isObj(raw)) return { ok: false, error: 'record is not an object' };
  if (raw.schema !== 'trampovision.jump-record') return { ok: false, error: 'not a trampovision jump record' };
  if (raw.version !== 1) return { ok: false, error: `unsupported record version ${String(raw.version)}` };
  const { id, videoId, jumpId, prediction, analysis } = raw;
  if (!str(id) || !str(videoId) || typeof jumpId !== 'number' || !Number.isInteger(jumpId) || jumpId < 1) {
    return { ok: false, error: 'id, videoId or jumpId is missing' };
  }
  if (id !== `${videoId}:${jumpId}`) return { ok: false, error: 'id does not match videoId and jumpId' };
  if (!isObj(prediction) || typeof prediction.skill !== 'string' || typeof prediction.confidence !== 'number') {
    return { ok: false, error: 'prediction is missing' };
  }
  const classifier = isObj(analysis) && isObj(analysis.classifier) ? analysis.classifier : null;
  if (!classifier || !str(classifier.id) || !str(classifier.version))
    return { ok: false, error: 'classifier is missing' };
  const record = JSON.stringify(raw);
  if (record.length > MAX_RECORD_BYTES) return { ok: false, error: 'record is too large' };
  const elementId = typeof prediction.elementId === 'string' ? prediction.elementId : null;
  return {
    ok: true,
    value: {
      id,
      video_id: videoId,
      jump_id: jumpId,
      auto_skill: prediction.skill,
      auto_element_id: elementId,
      auto_certainty: typeof prediction.certainty === 'string' ? prediction.certainty : null,
      auto_confidence: prediction.confidence,
      classifier: `${classifier.id}@${classifier.version}`,
      fingerprint: fingerprint(raw),
      record,
    },
  };
}

export function parseIngest(body: unknown): Parsed<JumpRow[]> {
  if (!isObj(body) || !Array.isArray(body.records)) return { ok: false, error: 'expected { records: [...] }' };
  if (body.records.length === 0) return { ok: false, error: 'no records' };
  if (body.records.length > MAX_RECORDS_PER_POST) {
    return { ok: false, error: `at most ${MAX_RECORDS_PER_POST} records per request` };
  }
  const rows: JumpRow[] = [];
  for (const [k, r] of body.records.entries()) {
    const row = rowOf(r);
    if (!row.ok) return { ok: false, error: `record ${k}: ${row.error}` };
    rows.push(row.value);
  }
  return { ok: true, value: rows };
}

export interface ReviewFields {
  status: Status;
  review_element_id: string | null;
  review_note: string | null;
  reviewer: string | null;
}

/**
 * A reviewer's verdict on a jump whose automatic answer is `autoElementId` (null when it was left unclassified).
 * confirm = the automatic figure was right. correct = it was another figure of the table. unknown = cannot tell.
 * bad-data = the recording cannot show the movement, so the jump must not teach the classifier anything.
 */
export function parseReview(body: unknown, autoElementId: string | null): Parsed<ReviewFields> {
  if (!isObj(body)) return { ok: false, error: 'expected an object' };
  const verdict = body.verdict;
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    return { ok: false, error: `verdict must be one of ${VERDICTS.join(', ')}` };
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const reviewer = typeof body.reviewer === 'string' && body.reviewer.trim() ? body.reviewer.trim().slice(0, 80) : null;
  const base = { review_note: note, reviewer };
  switch (verdict as Verdict) {
    case 'confirm':
      if (!autoElementId) return { ok: false, error: 'there is no automatic figure to confirm: use correct' };
      return { ok: true, value: { ...base, status: 'confirmed', review_element_id: autoElementId } };
    case 'correct': {
      const id = body.elementId;
      if (typeof id !== 'string' || !elementById(id))
        return { ok: false, error: 'elementId is not in the element table' };
      return { ok: true, value: { ...base, status: 'corrected', review_element_id: id } };
    }
    case 'unknown':
      return { ok: true, value: { ...base, status: 'unknown', review_element_id: null } };
    case 'bad-data':
      return { ok: true, value: { ...base, status: 'bad-data', review_element_id: null } };
  }
}

/** Constant-time comparison of a bearer token. */
export function tokenMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = header.slice(7);
  let diff = a.length ^ secret.length;
  for (let i = 0; i < Math.max(a.length, secret.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * The origins the browser may call from: the app, localhost for development and, when `previewPattern` is set, the preview
 * deployments of the app. The pattern is a regular expression matched against the whole origin (an invalid one allows nothing).
 */
export function originAllowed(origin: string | null, allowed: string, previewPattern?: string): boolean {
  if (!origin) return false;
  if (origin === allowed || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  if (!previewPattern) return false;
  try {
    return new RegExp(`^(?:${previewPattern})$`).test(origin);
  } catch {
    return false;
  }
}
