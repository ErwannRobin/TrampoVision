import { t } from '../i18n/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseDataset } from './export';
import { mergeRecords, openDatasetStore, type DatasetStore } from './store';
import type { JumpRecord } from './types';

export interface DatasetApi {
  ready: boolean;
  kind: DatasetStore['kind'] | null;
  /** Set when the browser's local storage could not be used. */
  warning: string | null;
  error: string | null;
  records: JumpRecord[];
  /** Adds or replaces records by id. */
  save: (records: JumpRecord[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  clear: () => Promise<void>;
  /** Merges the text of a dataset file: new jumps are added, a newer copy replaces an older one. */
  importText: (text: string) => Promise<{ added: number; updated: number; kept: number }>;
}

/** The local dataset: loaded once from the browser's own database, kept in memory for the UI, written through on every change. */
export function useDataset(): DatasetApi {
  const [records, setRecords] = useState<JumpRecord[]>([]);
  const [kind, setKind] = useState<DatasetApi['kind']>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storeP = useRef<Promise<DatasetStore> | null>(null);
  const recordsRef = useRef<JumpRecord[]>([]);
  recordsRef.current = records;

  if (!storeP.current && typeof window !== 'undefined') {
    storeP.current = openDatasetStore().then(({ store, warning: w }) => {
      setKind(store.kind);
      setWarning(w ?? null);
      return store;
    });
  }

  useEffect(() => {
    let cancelled = false;
    void storeP.current
      ?.then((s) => s.all())
      .then((all) => {
        if (!cancelled) setRecords(all);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (fn: (s: DatasetStore) => Promise<void>) => {
    try {
      const store = await storeP.current!;
      await fn(store);
      setError(null);
    } catch (e) {
      setError(t('err.dbWrite', { message: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const save = useCallback(
    async (rs: JumpRecord[]) => {
      const ids = new Set(rs.map((r) => r.id));
      setRecords((prev) => [...prev.filter((r) => !ids.has(r.id)), ...rs]);
      await persist((s) => s.put(rs));
    },
    [persist],
  );
  const remove = useCallback(
    async (ids: string[]) => {
      setRecords((prev) => prev.filter((r) => !ids.includes(r.id)));
      await persist((s) => s.remove(ids));
    },
    [persist],
  );
  const clear = useCallback(async () => {
    setRecords([]);
    await persist((s) => s.clear());
  }, [persist]);
  const importText = useCallback(
    async (text: string) => {
      const incoming = parseDataset(text);
      const { toPut, added, updated, kept } = mergeRecords(recordsRef.current, incoming);
      if (toPut.length) await save(toPut);
      return { added, updated, kept };
    },
    [save],
  );

  return { ready: kind !== null, kind, warning, error, records, save, remove, clear, importText };
}
