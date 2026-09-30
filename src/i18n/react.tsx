import { Fragment, type ReactNode, useSyncExternalStore } from 'react';
import { typography } from './core';
import { getLocale, subscribeLocale } from './locale';
import { messages, type StringKey } from './messages';

/** The language in use; a component that reads it renders again when it changes. */
export const useLocale = () => useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const);

/** Like `t`, for a sentence that holds a piece of the interface (a bold name, a link): holes take React nodes. */
export function tx(key: StringKey, holes: Record<string, ReactNode>): ReactNode[] {
  const locale = getLocale();
  const template = typography((messages[locale]?.[key] ?? messages.en[key] ?? key) as string, locale);
  return template.split(/(\{\w+\})/).map((part, i) => {
    const hole = /^\{(\w+)\}$/.exec(part);
    return <Fragment key={i}>{hole && hole[1] in holes ? holes[hole[1]] : part}</Fragment>;
  });
}
