import { t } from '../i18n/core';
import { done, openDatabase, STORE_SET_DATA, STORE_SETS, wrap } from '../dataset/db';

/**
 * Recent sets: every finished analysis, kept on this device so that a set survives leaving it, reloading the page and closing the
 * browser. A set is the analysis and nothing else (never the video): the text of the "Save analysis" JSON, the same file the
 * advanced tools export and open, plus one line of figures for the list on the first screen. What the coach said about each skill
 * is kept with the dataset (by video), so a set reopens with its corrections.
 */

/** The most sets that are kept. A new one past the limit pushes the oldest out. */
export const HISTORY_LIMIT = 20;

/** What the list shows about a set, as the live view computed it. */
export interface SetFigures {
  /** Skills of the set that count, guesses that wait for a check left out. */
  skills: number;
  /** Skills the classifier only guessed at. */
  pending: number;
  /** Sum of the difficulty of the skills. */
  difficulty: number;
  /** Jumps found in the clip, skills or not. */
  jumps: number;
}

/** One line of the list. */
export interface SetSummary extends SetFigures {
  /** The id of the video the set was filmed in: one set per video, a new analysis of the same clip replaces the old one. */
  id: string;
  /** The file name of the clip. Empty when it is not known. */
  fileName: string;
  /** When the set was last saved (ISO 8601). */
  savedAt: string;
}

/** A set with its analysis. */
export interface SavedSet extends SetSummary {
  /** The text of the pose-series JSON (see `analysis/timeSeries`): `parsePoseSeries` reads it back. */
  series: string;
}

export interface HistoryStore {
  readonly kind: 'indexeddb' | 'memory';
  /** The lines of the list, newest first. No analysis is read. */
  list(): Promise<SetSummary[]>;
  get(id: string): Promise<SavedSet | null>;
  /** Adds a set or replaces the one with the same id, then drops the oldest ones past the limit. */
  put(set: SavedSet): Promise<void>;
  /** Replaces the line of a set that is stored, leaving its analysis as it is. False when there is no such set. */
  update(summary: SetSummary): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const newestFirst = (a: SetSummary, b: SetSummary): number =>
  b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id);

/** The ids to drop so that at most `limit` sets remain: the oldest ones, never `keep` (the set that was just written). */
export function evictions(list: readonly SetSummary[], limit = HISTORY_LIMIT, keep?: string): string[] {
  const excess = list.length - limit;
  if (excess <= 0) return [];
  return [...list]
    .filter((s) => s.id !== keep)
    .sort(newestFirst)
    .slice(-excess)
    .map((s) => s.id);
}

/** The summary of a set: what the list needs, without the analysis. */
export function summaryOf({ id, fileName, savedAt, skills, pending, difficulty, jumps }: SetSummary): SetSummary {
  return { id, fileName, savedAt, skills, pending, difficulty, jumps };
}

export function createMemoryHistory(initial: SavedSet[] = []): HistoryStore {
  const map = new Map(initial.map((s) => [s.id, s]));
  return {
    kind: 'memory',
    async list() {
      return [...map.values()].map(summaryOf).sort(newestFirst);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async put(set) {
      map.set(set.id, set);
      for (const id of evictions([...map.values()], HISTORY_LIMIT, set.id)) map.delete(id);
    },
    async update(summary) {
      const have = map.get(summary.id);
      if (!have) return false;
      map.set(summary.id, { ...summaryOf(summary), series: have.series });
      return true;
    },
    async remove(id) {
      map.delete(id);
    },
    async clear() {
      map.clear();
    },
  };
}

/** Opens the recent sets in the browser's local database. When it is unavailable (private mode, blocked storage) they live in memory. */
export async function openHistoryStore(): Promise<{ store: HistoryStore; warning?: string }> {
  try {
    const db = await openDatabase();
    const store: HistoryStore = {
      kind: 'indexeddb',
      async list() {
        const all = (await wrap(
          db.transaction(STORE_SETS, 'readonly').objectStore(STORE_SETS).getAll(),
        )) as SetSummary[];
        return all.sort(newestFirst);
      },
      async get(id) {
        const tx = db.transaction([STORE_SETS, STORE_SET_DATA], 'readonly');
        const [summary, data] = await Promise.all([
          wrap(tx.objectStore(STORE_SETS).get(id)) as Promise<SetSummary | undefined>,
          wrap(tx.objectStore(STORE_SET_DATA).get(id)) as Promise<{ id: string; series: string } | undefined>,
        ]);
        return summary && data ? { ...summary, series: data.series } : null;
      },
      async put(set) {
        // One transaction: the set, its analysis and the eviction of the oldest ones land together or not at all.
        const tx = db.transaction([STORE_SETS, STORE_SET_DATA], 'readwrite');
        const sets = tx.objectStore(STORE_SETS);
        const data = tx.objectStore(STORE_SET_DATA);
        sets.put(summaryOf(set));
        data.put({ id: set.id, series: set.series });
        const all = sets.getAll();
        all.onsuccess = () => {
          for (const id of evictions(all.result as SetSummary[], HISTORY_LIMIT, set.id)) {
            sets.delete(id);
            data.delete(id);
          }
        };
        await done(tx);
      },
      async update(summary) {
        const tx = db.transaction(STORE_SETS, 'readwrite');
        const sets = tx.objectStore(STORE_SETS);
        let found = false;
        const have = sets.get(summary.id);
        have.onsuccess = () => {
          if (have.result) {
            found = true;
            sets.put(summaryOf(summary));
          }
        };
        await done(tx);
        return found;
      },
      async remove(id) {
        const tx = db.transaction([STORE_SETS, STORE_SET_DATA], 'readwrite');
        tx.objectStore(STORE_SETS).delete(id);
        tx.objectStore(STORE_SET_DATA).delete(id);
        await done(tx);
      },
      async clear() {
        const tx = db.transaction([STORE_SETS, STORE_SET_DATA], 'readwrite');
        tx.objectStore(STORE_SETS).clear();
        tx.objectStore(STORE_SET_DATA).clear();
        await done(tx);
      },
    };
    return { store };
  } catch (err) {
    return {
      store: createMemoryHistory(),
      warning: t('err.storeWarning', { message: err instanceof Error ? err.message : String(err) }),
    };
  }
}
