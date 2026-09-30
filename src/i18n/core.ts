import { getLocale, type Locale } from './locale';
import { messages, type PluralKey, type StringKey } from './messages';

export {
  LANGUAGE_NAMES,
  LOCALES,
  getLocale,
  localeReady,
  matchLocale,
  setLocale,
  subscribeLocale,
  type Locale,
} from './locale';
export { hasMessages, loadMessages } from './messages';
export type { MessageKey, PluralKey, StringKey } from './messages';

export type Params = Record<string, string | number>;

/** Fills `{name}` holes. A hole with no value is left as it is, so a missing parameter shows in the text instead of vanishing. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole));
}

/** French puts a no-break space before : ; ? ! and inside « »: the messages are written with plain spaces and it is done here. */
export const typography = (text: string, locale: Locale): string =>
  locale === 'fr' ? text.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0') : text;

/**
 * A message in the language in use (English where a translation is missing, the key itself where there is no message at all).
 * `locale` asks for another language: the canonical English of a name that is kept in data, for instance.
 */
export function t(key: StringKey, params?: Params, locale: Locale = getLocale()): string {
  const template = (messages[locale]?.[key] ?? messages.en[key] ?? key) as string;
  return typography(interpolate(template, params), locale);
}

/** First letter in capitals (a name built from lowercase words starts a sentence). No effect on Japanese. */
export const upperFirst = (s: string, locale: Locale = getLocale()): string =>
  s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;

/** Lowercase, for a label ("Tuck") that goes inside a sentence ("(tuck)"). */
export const lower = (s: string, locale: Locale = getLocale()): string => s.toLocaleLowerCase(locale);

const rules = new Map<Locale, Intl.PluralRules>();
/** The plural category of a count in a language: English and German tell one from many, French counts 0 and 1 as one, Japanese has one form. */
export function pluralCategory(count: number, locale: Locale = getLocale()): 'one' | 'other' {
  let r = rules.get(locale);
  if (!r) rules.set(locale, (r = new Intl.PluralRules(locale)));
  return r.select(count) === 'one' ? 'one' : 'other';
}

/** A message that depends on a count: `{n}` is the count unless a parameter says otherwise. */
export function tp(key: PluralKey, count: number, params?: Params, locale: Locale = getLocale()): string {
  const forms = (messages[locale]?.[key] ?? messages.en[key]) as { one: string; other: string } | undefined;
  if (!forms) return key;
  return typography(interpolate(forms[pluralCategory(count, locale)], { n: count, ...params }), locale);
}

/** A small negative number that rounds to zero comes out as "-0" (or "-0,0", "-0 %"): nobody wants to read that, so the sign goes. */
const NEGATIVE_ZERO = /^[-\u2212](?=0(?:[.,]0+)?(?:[^\d.,]|$))/;
const unsigned = (text: string): string => text.replace(NEGATIVE_ZERO, '');

/** A share between 0 and 1 as the language writes a percentage (50% in English, 50 % in French and German). */
export function formatPercent(fraction: number, digits = 0, locale: Locale = getLocale()): string {
  return unsigned(
    new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(fraction),
  );
}

/**
 * A table of names that follows the language: `lazyText({ high: 'tier.high' })` reads like a constant (`TIER_TEXT.high`) and gives the
 * message of the language in use every time it is read. For the lookup tables that would otherwise fix the text at load.
 */
export function lazyText<K extends string>(keys: Record<K, StringKey>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k]) });
  return out;
}

const decimals = new Map<string, Intl.NumberFormat>();
/** A number as short as it can be, with at most `maxDigits` decimals (1.5, 2, 0.25), written the way the language writes it. */
export function formatDecimal(value: number, maxDigits = 2, locale: Locale = getLocale()): string {
  const key = `${locale}:${maxDigits}`;
  let f = decimals.get(key);
  if (!f)
    decimals.set(
      key,
      (f = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDigits,
        useGrouping: false,
      })),
    );
  return unsigned(f.format(value));
}

const formats = new Map<string, Intl.NumberFormat>();
/** A number with a fixed count of decimals, written the way the language writes it (0,6 in French and German, 0.6 in English and Japanese). */
export function formatNumber(value: number, digits = 1, locale: Locale = getLocale()): string {
  const key = `${locale}:${digits}`;
  let f = formats.get(key);
  if (!f)
    formats.set(
      key,
      (f = new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      })),
    );
  return unsigned(f.format(value));
}
