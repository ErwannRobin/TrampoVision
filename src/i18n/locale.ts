/** The languages of the interface. English is the source of every message; the others are checked against it (see `messages/`). */
export const LOCALES = ['en', 'fr', 'de', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language in its own language: what a person looks for in a list of languages. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français', de: 'Deutsch', ja: '日本語' };

import { hasMessages, loadMessages } from './messages';

const STORAGE_KEY = 'trampovision.language';

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** The first of the browser's preferred languages that the app speaks ("fr-CA" is French); null when none. */
export function matchLocale(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

function stored(): Locale | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null; // storage can be blocked: the browser's language decides
  }
}

function initial(): Locale {
  const saved = stored();
  if (saved) return saved;
  // Scripts and tests (no window) always read English, whatever the language of the machine they run on.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'en';
  return matchLocale(navigator.languages?.length ? navigator.languages : [navigator.language]) ?? 'en';
}

// The language in use starts as English; the one that was chosen (or detected) takes over as soon as its messages are there.
let current: Locale = 'en';
let wanted: Locale = 'en';
const listeners = new Set<() => void>();

const applyToDocument = (locale: Locale) => {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
};
applyToDocument(current);

export const getLocale = (): Locale => current;

/**
 * Changes the language of the whole interface and remembers it. Text that was built earlier (analysis results) is rebuilt by its
 * owners. A language whose messages are not loaded yet is fetched first: the promise resolves once the interface has changed.
 */
export function setLocale(next: Locale, remember = true): Promise<void> {
  wanted = next;
  const apply = () => {
    // Asking for another language while this one was loading: the last ask wins.
    if (wanted !== next || next === current) return;
    current = next;
    applyToDocument(next);
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* the choice lasts for this visit only */
      }
    }
    for (const listener of listeners) listener();
  };
  if (hasMessages(next)) {
    apply();
    return Promise.resolve();
  }
  return loadMessages(next).then(apply);
}

/** Resolves once the language that was chosen or detected is the one in use: the first screen waits for it, so it never shows in another language first. */
export const localeReady: Promise<void> = setLocale(initial(), false);

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
