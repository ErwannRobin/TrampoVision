import { done, wrap } from '../dataset/db';
import { t } from '../i18n/core';

/**
 * How the result video of the motion page (/motion.html) gets to the app. They are two pages of one site, and a video does not survive the
 * move from one to the other (an object URL dies with its page), so the page leaves the video in a small database of its own, goes to the
 * address of the app with `?from=motion`, and the app takes the video out, once, and opens it like one the person chose. A database of its
 * own and not the app's (`dataset/db.ts`): nothing the app keeps is upgraded or touched.
 */

/** Where the motion page sends the person: the app, told that a video is waiting for it. */
export const APP_WITH_RESULT = '/?from=motion';

const DB_NAME = 'trampovision-motion-handoff';
const STORE = 'result';
/** One video at a time: a new result replaces one that was never taken. */
const KEY = 'latest';

interface Stored {
  name: string;
  type: string;
  blob: Blob;
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error(t('err.idbMissing')));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('err.idbOpen')));
    req.onblocked = () => reject(new Error(t('err.idbBlocked')));
  });
}

/** Runs `use` on the store in one transaction, and lets go of the database once the transaction is over. */
async function inStore<T>(use: (store: IDBObjectStore) => Promise<T> | T): Promise<Awaited<T>> {
  const db = await openStore();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const [, value] = await Promise.all([done(tx), use(tx.objectStore(STORE))]);
    return value;
  } finally {
    db.close();
  }
}

/** Leaves `file` for the app. */
export function putHandoff(file: File): Promise<void> {
  const stored: Stored = { name: file.name, type: file.type, blob: file };
  return inStore((store) => void store.put(stored, KEY));
}

/** Takes the video out and leaves nothing behind: null when there is none. */
function takeStored(): Promise<File | null> {
  return inStore(async (store) => {
    // Read, then delete, in the same transaction: the read sees the video, and a second page that asks finds nothing.
    const found = wrap(store.get(KEY)) as Promise<Stored | undefined>;
    store.delete(KEY);
    const stored = await found;
    return stored ? new File([stored.blob], stored.name, { type: stored.type }) : null;
  });
}

const FROM = 'from';
const SOURCE = 'motion';

/** Whether the address (`location.search`) says that the motion page left a video for the app. */
export const handoffWaiting = (search: string): boolean => new URLSearchParams(search).get(FROM) === SOURCE;

/** The address without that mark, and without the `?` when nothing else is left: a reload then does not look for a video again. */
export function withoutHandoff(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get(FROM) !== SOURCE) return search;
  params.delete(FROM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

let received: Promise<File | null> | null = null;

/**
 * The video the motion page left for the app, when the address says there is one (null when there is not). It is taken once and the
 * address is cleaned. Asking again gets the same answer and not an empty store: React runs an effect twice in development.
 */
export function receiveHandoff(): Promise<File | null> {
  received ??= handoffWaiting(location.search)
    ? takeStored().finally(() =>
        history.replaceState(null, '', location.pathname + withoutHandoff(location.search) + location.hash),
      )
    : Promise.resolve(null);
  return received;
}
