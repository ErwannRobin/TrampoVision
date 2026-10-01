import { t } from '../i18n/core';
import { done, openDatabase, STORE_RECORDS as STORE, wrap } from './db';
import type { JumpRecord } from './types';

/** Where the dataset lives. Everything stays in this browser: IndexedDB when it works, memory when it does not. */
export interface DatasetStore {
  readonly kind: 'indexeddb' | 'memory';
  all(): Promise<JumpRecord[]>;
  put(records: JumpRecord[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryStore(initial: JumpRecord[] = []): DatasetStore {
  const map = new Map(initial.map((r) => [r.id, r]));
  return {
    kind: 'memory',
    async all() {
      return [...map.values()];
    },
    async put(records) {
      for (const r of records) map.set(r.id, r);
    },
    async remove(ids) {
      for (const id of ids) map.delete(id);
    },
    async clear() {
      map.clear();
    },
  };
}

/** Opens the browser's local database. When it is unavailable (private mode, blocked storage) the dataset lives in memory and `warning` says so. */
export async function openDatasetStore(): Promise<{ store: DatasetStore; warning?: string }> {
  try {
    const db = await openDatabase();
    const store: DatasetStore = {
      kind: 'indexeddb',
      async all() {
        return (await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as JumpRecord[];
      },
      async put(records) {
        const tx = db.transaction(STORE, 'readwrite');
        for (const r of records) tx.objectStore(STORE).put(r);
        await done(tx);
      },
      async remove(ids) {
        const tx = db.transaction(STORE, 'readwrite');
        for (const id of ids) tx.objectStore(STORE).delete(id);
        await done(tx);
      },
      async clear() {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        await done(tx);
      },
    };
    return { store };
  } catch (err) {
    return {
      store: createMemoryStore(),
      warning: t('err.storeWarning', { message: err instanceof Error ? err.message : String(err) }),
    };
  }
}

/** Records to write when `incoming` is merged into `existing`: a new id is added, a known id is replaced only by a newer copy. */
export function mergeRecords(
  existing: JumpRecord[],
  incoming: JumpRecord[],
): { toPut: JumpRecord[]; added: number; updated: number; kept: number } {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const toPut: JumpRecord[] = [];
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const r of incoming) {
    const have = byId.get(r.id);
    if (!have) {
      toPut.push(r);
      added++;
    } else if (r.savedAt > have.savedAt) {
      toPut.push(r);
      updated++;
    } else kept++;
  }
  return { toPut, added, updated, kept };
}
