import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Autosaver, type SetSnapshot } from './autosave';
import { openHistoryStore, type HistoryStore, type SavedSet, type SetSummary } from './store';

export interface HistoryApi {
  /** The list has been read. */
  ready: boolean;
  /** Newest first. */
  sets: SetSummary[];
  /** Stores a set. False when it could not be written (storage full or blocked): nothing else breaks. */
  save: (set: SavedSet) => Promise<boolean>;
  /** Stores the line of a set that is already stored. False when there is no such set or the write failed. */
  update: (summary: SetSummary) => Promise<boolean>;
  /** The set with its analysis, or null when it is gone. */
  load: (id: string) => Promise<SavedSet | null>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** The recent sets kept in this browser: read once, kept in memory for the first screen, written through on every change. */
export function useHistory(): HistoryApi {
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [ready, setReady] = useState(false);
  const storeP = useRef<Promise<HistoryStore> | null>(null);
  if (!storeP.current && typeof window !== 'undefined') storeP.current = openHistoryStore().then(({ store }) => store);

  const refresh = useCallback(async (store: HistoryStore) => {
    setSets(await store.list());
  }, []);

  useEffect(() => {
    let live = true;
    void storeP.current
      ?.then((s) => s.list())
      .then((all) => {
        if (live) setSets(all);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  /** Runs a write and says whether it worked. A failure (storage full, blocked, closed) is an answer, never an exception. */
  const attempt = useCallback(
    async <T>(fn: (store: HistoryStore) => Promise<T>, failed: T): Promise<T> => {
      let store: HistoryStore;
      let out: T;
      try {
        store = await storeP.current!;
        out = await fn(store);
      } catch {
        return failed;
      }
      // The write is done: a list that cannot be read again does not make it a failure.
      await refresh(store).catch(() => undefined);
      return out;
    },
    [refresh],
  );

  const save = useCallback(
    (set: SavedSet) =>
      attempt(async (s) => {
        await s.put(set);
        return true;
      }, false),
    [attempt],
  );
  const update = useCallback((summary: SetSummary) => attempt((s) => s.update(summary), false), [attempt]);
  const load = useCallback(async (id: string) => {
    try {
      return await (await storeP.current!).get(id);
    } catch {
      return null;
    }
  }, []);
  const remove = useCallback(
    async (id: string) => {
      await attempt((s) => s.remove(id), undefined);
    },
    [attempt],
  );
  const clear = useCallback(async () => {
    await attempt((s) => s.clear(), undefined);
  }, [attempt]);

  return useMemo(
    () => ({ ready, sets, save, update, load, remove, clear }),
    [ready, sets, save, update, load, remove, clear],
  );
}

/**
 * Keeps the set on screen stored (see `Autosaver`): pass what is on screen, or null when there is nothing to save. The result says
 * `flush()` to write at once what is waiting, and `adopt` for a set that was just opened from the list.
 */
export function useAutosave(history: HistoryApi, snapshot: SetSnapshot | null): Autosaver {
  const api = useRef(history);
  api.current = history;
  const saver = useMemo(
    () =>
      new Autosaver({
        save: (set) => api.current.save(set),
        update: (summary) => api.current.update(summary),
      }),
    [],
  );
  useEffect(() => {
    saver.update(snapshot);
  }, [saver, snapshot]);
  useEffect(() => () => saver.dispose(), [saver]);
  return saver;
}
