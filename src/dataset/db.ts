import { t } from '../i18n/core';

/**
 * The browser's local database, shared by everything that is kept on this device: the jump dataset (version 1) and the recent sets
 * (version 2). One database, one upgrade: every store is created here, and a store that already exists is never touched, so a
 * version that adds a store keeps what the earlier versions saved.
 */
export const DB_NAME = 'trampovision';
export const DB_VERSION = 2;

/** Version 1: the jumps the coach labelled. */
export const STORE_RECORDS = 'jump-records';
/** Version 2: one line per recent set (name, date, totals). Small, so the landing can list them without reading any pose data. */
export const STORE_SETS = 'recent-sets';
/** Version 2: the analysis of each recent set, as the text of the "Save analysis" JSON. Read one at a time, when a set is opened. */
export const STORE_SET_DATA = 'recent-set-data';

/** What the upgrade needs of a database: a real `IDBDatabase` has it, and so does a stand-in in a test. */
export type SchemaDb = Pick<IDBDatabase, 'objectStoreNames' | 'createObjectStore'>;

/** Creates the stores that are missing. It never deletes or recreates one, so data saved by an earlier version survives. */
export function upgradeSchema(db: SchemaDb): void {
  for (const name of [STORE_RECORDS, STORE_SETS, STORE_SET_DATA]) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
  }
}

export const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('err.idbRequest')));
  });

export const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(t('err.idbTransaction')));
    tx.onabort = () => reject(tx.error ?? new Error(t('err.idbAborted')));
  });

let opening: Promise<IDBDatabase> | null = null;

/** Opens (and, the first time after an update, upgrades) the database. Every store of the app shares the one connection. */
export function openDatabase(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error(t('err.idbMissing')));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgradeSchema(req.result);
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app in another tab must be able to upgrade: let go of the database when it asks.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error(t('err.idbOpen')));
    req.onblocked = () => reject(new Error(t('err.idbBlocked')));
  }).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}
