import type { Locale } from '../locale';
import { en } from './en';

export type Plural = { readonly one: string; readonly other: string };

type En = typeof en;
export type MessageKey = keyof En;
/** Keys whose message is a sentence, and keys whose message changes with a count. */
export type StringKey = { [K in MessageKey]: En[K] extends string ? K : never }[MessageKey];
export type PluralKey = { [K in MessageKey]: En[K] extends string ? never : K }[MessageKey];

/** What a translation of some messages has to hold: the keys of the English ones, a sentence where English has one and both forms where it has a count. */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Plural };

/** What a translation has to hold: every key of English. */
export type Dictionary = Translation<En>;

/**
 * The messages that are loaded: English always (it is the source, and the fallback of every other language), and the others once
 * `loadMessages` has fetched them. A language is a separate chunk of the build, so a visitor downloads the one they read.
 */
export const messages: { en: Dictionary } & Partial<Record<Locale, Dictionary>> = { en };

const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<Dictionary>> = {
  fr: () => import('./fr').then((m) => m.fr),
  de: () => import('./de').then((m) => m.de),
  ja: () => import('./ja').then((m) => m.ja),
};

const loading = new Map<Locale, Promise<void>>();

export const hasMessages = (locale: Locale): boolean => messages[locale] !== undefined;

/** Fetches the messages of a language; resolves once `t` can read them (at once for English and for a language already fetched). */
export function loadMessages(locale: Locale): Promise<void> {
  if (locale === 'en' || messages[locale]) return Promise.resolve();
  let pending = loading.get(locale);
  if (!pending) {
    pending = LOADERS[locale]().then((dictionary) => {
      messages[locale] = dictionary;
    });
    loading.set(locale, pending);
  }
  return pending;
}
