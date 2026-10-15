import { done, wrap } from '../dataset/db';
import { t } from '../i18n/core';
import { POSE_ENGINES } from '../pose/engines';
import type { ModelVariant, PoseEngineId } from '../pose/types';
import type { MotionConfig } from './config';

/**
 * How the result video of the motion page (/motion.html) gets to the app. They are two pages of one site, and a video does not survive the
 * move from one to the other (an object URL dies with its page), so the page leaves the video in a small database of its own, goes to the
 * address of the app with `?from=motion`, and the app takes the video out, once, and opens it like one the person chose. A database of its
 * own and not the app's (`dataset/db.ts`): nothing the app keeps is upgraded or touched.
 *
 * Two videos are left: the clip as it was, which the app shows, and the clip with the background hidden, which the pose model is given.
 * And the page's settings, with which the app analyzes the clip the way the page showed it (`PageSettings`).
 */

/** Where the motion page sends the person: the app, told that a video is waiting for it. */
export const APP_WITH_RESULT = '/?from=motion';

const DB_NAME = 'trampovision-motion-handoff';
const STORE = 'result';
/** One video at a time: a new result replaces one that was never taken. */
const KEY = 'latest';

interface StoredFile {
  name: string;
  type: string;
  blob: Blob;
}

interface Stored {
  original: StoredFile;
  masked: StoredFile;
  /** Absent in records left by an earlier version: read as false. */
  zoom?: boolean;
  /** Absent in records left by an earlier version: the app then reads `masked`, or decides by `zoom`. */
  settings?: unknown;
}

/**
 * The motion page's settings when the person sent the result to the app. With them, the app analyzes the clip live through the detector
 * (`withMotionMask`) the way the page showed it, instead of reading the rendered video: the zoom, the turn and the skeleton kept in the
 * mask depend on what the pose model finds, which a video cannot carry, and the thresholds and the model are the ones the person looked at.
 * What the app does after the pose model (who the jumper is over the whole clip, the tracks, the jumps) stays its own.
 */
export interface PageSettings {
  /** The detector's thresholds as the page had them: its sliders, the kind of shot, the people kept, the look above the region. */
  config: Partial<MotionConfig>;
  /** What is painted over the background (a CSS color). */
  fill: string;
  /** Whether the background is hidden before the pose model. */
  hide: boolean;
  /** Whether the mask keeps the skeleton the pose model found in the frame before (`MotionMaskOptions.keepBodies`). */
  keepBodies: boolean;
  /** The zoom on a small athlete and the upright turn (`MotionMaskOptions.view`). */
  zoom: boolean;
  rotate: boolean;
  /** The pose model: the first one ticked on the page, the one whose skeleton the mask keeps. */
  engine: PoseEngineId;
  model: ModelVariant;
  preferGpu: boolean;
}

const VARIANTS: readonly ModelVariant[] = ['lite', 'full', 'heavy'];

/**
 * The settings in a stored record, or undefined when there are none or they are not what this version of the app understands (a record
 * left by another version): the app then does what it did before the page sent its settings.
 */
export function readSettings(value: unknown): PageSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const s = value as Record<string, unknown>;
  const flags = ['hide', 'keepBodies', 'zoom', 'rotate', 'preferGpu'] as const;
  if (flags.some((key) => typeof s[key] !== 'boolean')) return undefined;
  if (typeof s.fill !== 'string' || typeof s.config !== 'object' || s.config === null) return undefined;
  if (!POSE_ENGINES.includes(s.engine as PoseEngineId) || !VARIANTS.includes(s.model as ModelVariant)) return undefined;
  return value as PageSettings;
}

/** What the motion page leaves for the app. */
export interface Handoff {
  /** The clip as the person chose it: what the app shows. */
  original: File;
  /**
   * The clip with the background hidden: what the pose model is given when the app does not analyze the clip live (its motion detector
   * is switched off, or the record came without `settings`).
   */
  masked: File;
  /**
   * True when the app should analyze the clip live through the motion detector with the zoomed view of the athlete
   * (`withMotionMask`, `view.zoom`) instead of reading `masked`: the motion page saw that the athlete is small on a steady
   * shot in most frames (`ZOOM_WINS_SHARE`), where only the zoomed view lets the pose model see them. Read only without `settings`.
   */
  zoom: boolean;
  /** The page's settings, which the app analyzes the clip live with (`PageSettings`); undefined from a record left by an earlier version. */
  settings?: PageSettings;
}

const toStored = (file: File): StoredFile => ({ name: file.name, type: file.type, blob: file });
/**
 * The file, with its bytes in memory. A blob that comes out of IndexedDB is backed by a file of the browser's, and Safari does not play
 * a video from one (it says the format is not supported), so the bytes are copied out and the file is made from them.
 */
const toFile = async ({ name, type, blob }: StoredFile): Promise<File> =>
  new File([await blob.arrayBuffer()], name, { type });

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

/** Leaves the two videos for the app. */
export function putHandoff({ original, masked, zoom, settings }: Handoff): Promise<void> {
  const stored: Stored = { original: toStored(original), masked: toStored(masked), zoom, settings };
  return inStore((store) => void store.put(stored, KEY));
}

/**
 * Takes the videos out and leaves nothing behind: null when there are none (or a single video, as an earlier version left it).
 * The record is deleted only once the bytes are read: Safari backs a stored blob with a file that goes when the record goes, and a blob
 * read after that fails ("The object can not be found here", WebKitBlobResource error 1).
 */
async function takeStored(): Promise<Handoff | null> {
  const stored = await inStore((store) => wrap(store.get(KEY)) as Promise<Partial<Stored> | undefined>);
  try {
    return stored?.original && stored.masked
      ? {
          original: await toFile(stored.original),
          masked: await toFile(stored.masked),
          zoom: stored.zoom ?? false,
          settings: readSettings(stored.settings),
        }
      : null;
  } finally {
    // A video that could not be cleaned away is no reason to lose the one that was read.
    await inStore((store) => void store.delete(KEY)).catch(() => undefined);
  }
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

let received: Promise<Handoff | null> | null = null;

/**
 * The videos the motion page left for the app, when the address says there is one (null when there is not). It is taken once and the
 * address is cleaned. Asking again gets the same answer and not an empty store: React runs an effect twice in development.
 */
export function receiveHandoff(): Promise<Handoff | null> {
  received ??= handoffWaiting(location.search)
    ? takeStored().finally(() =>
        history.replaceState(null, '', location.pathname + withoutHandoff(location.search) + location.hash),
      )
    : Promise.resolve(null);
  return received;
}
