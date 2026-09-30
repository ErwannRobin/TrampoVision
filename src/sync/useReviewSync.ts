import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisFingerprint } from '../dataset/record';
import type { JumpRecord } from '../dataset/types';
import {
  BATCH,
  OUTBOX_MAX,
  REVIEW_API_URL,
  chunk,
  fetchReferenceRecords,
  pendingRecords,
  postRecords,
  readOutbox,
  readSyncSetting,
  sendVerdict,
  writeOutbox,
  writeSyncSetting,
} from './reviewSync';

/** Wait for the analysis to settle (a threshold being dragged recomputes it many times) before posting. */
const SETTLE_MS = 1500;
const RETRY_MS = 30_000;

export type SyncState = 'unavailable' | 'off' | 'idle' | 'sending' | 'sent' | 'failed';

/** Whether the person allows the upload. Always false without a configured service. */
export function useSyncSetting() {
  const [enabled, setEnabledState] = useState(readSyncSetting);
  const setEnabled = useCallback((on: boolean) => {
    writeSyncSetting(on);
    setEnabledState(on);
  }, []);
  return { available: REVIEW_API_URL !== null, enabled: REVIEW_API_URL !== null && enabled, setEnabled };
}

export interface UploadStatus {
  state: SyncState;
  /** Jumps posted since the page opened. */
  posted: number;
}

/**
 * Posts each analyzed jump to the review service once its result is stable, and retries after a failure. It never blocks the analysis:
 * the classification is already on screen when the post starts.
 */
export function useReviewUpload(records: readonly JumpRecord[], enabled: boolean): UploadStatus {
  const [state, setState] = useState<SyncState>('idle');
  const [posted, setPosted] = useState(0);
  const [retry, setRetry] = useState(0);
  const sent = useRef(new Map<string, string>());

  useEffect(() => {
    if (!enabled) return;
    const todo = pendingRecords(records, sent.current);
    if (todo.length === 0) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setState('sending');
      try {
        for (const batch of chunk(todo, BATCH)) {
          await postRecords(batch);
          for (const r of batch) sent.current.set(r.id, analysisFingerprint(r));
          if (!cancelled) setPosted((n) => n + batch.length);
        }
        if (!cancelled) setState('sent');
      } catch {
        if (cancelled) return;
        setState('failed');
        retryTimer = setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
    };
  }, [records, enabled, retry]);

  return { state: enabled ? state : REVIEW_API_URL === null ? 'unavailable' : 'off', posted };
}

/** The jumps the reviewers confirmed or corrected, loaded when a video opens, as reference examples. Empty when the service is off or fails. */
export function useReviewedReferences(enabled: boolean, videoId: string | null): JumpRecord[] {
  const [remote, setRemote] = useState<JumpRecord[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchReferenceRecords()
      .then((rs) => !cancelled && setRemote(rs))
      .catch(() => {
        /* the classifier works without them */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, videoId]);
  return enabled ? remote : [];
}

/**
 * What the person says about a jump (its element, that it is none of them, the execution score they give) reaches the review service,
 * so the classifier learns from it on every device. The ids of the records to send are kept in the browser until they are delivered, and
 * a delivery that fails is tried again, so a practice hall with a poor connection loses nothing while the page stays open (and the
 * label itself is in the local dataset either way). Nothing is sent when the upload is off.
 */
export function useVerdictOutbox(records: readonly JumpRecord[], enabled: boolean) {
  const [ids, setIds] = useState<string[]>(readOutbox);
  const [retry, setRetry] = useState(0);
  const latest = useRef(records);
  latest.current = records;
  const inFlight = useRef(new Set<string>());
  const add = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev : [...prev, id].slice(-OUTBOX_MAX))),
    [],
  );

  useEffect(() => writeOutbox(ids), [ids]);

  useEffect(() => {
    if (!enabled || ids.length === 0) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      for (const id of ids) {
        // A record that is not saved yet (the label is on its way to the dataset) stays in the outbox for the next round.
        const record = records.find((r) => r.id === id);
        if (!record || inFlight.current.has(id)) continue;
        inFlight.current.add(id);
        try {
          await sendVerdict(record);
          // Changed again while it was on its way: it stays, and goes again.
          const current = latest.current.find((r) => r.id === id);
          if (!cancelled && (!current || current.savedAt === record.savedAt))
            setIds((prev) => prev.filter((x) => x !== id));
        } catch {
          if (!cancelled) retryTimer = setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
          return;
        } finally {
          inFlight.current.delete(id);
        }
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
    };
  }, [ids, records, enabled, retry]);

  return { add, waiting: ids.length };
}
