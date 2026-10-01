import { LANGUAGE_NAMES, LOCALES, setLocale, t, useLocale } from '../i18n';
import { Menu } from './kit';

export interface LanguageMenuProps {
  compact: boolean;
  /** Which edge of the button the list lines up with: `end` (the default) opens it to the left, `start` to the right. */
  align?: 'start' | 'end';
}

/** The language of the interface: the current one on the button, every one in the list, each in its own language. */
export function LanguageMenu({ compact, align }: LanguageMenuProps) {
  const locale = useLocale();
  return (
    <div className="langmenu">
      <Menu
        label={compact ? t('language.switch') : LANGUAGE_NAMES[locale]}
        icon="globe"
        iconOnly={compact}
        variant="ghost"
        size="sm"
        align={align}
        groups={[
          {
            id: 'language',
            title: t('language.switch'),
            items: LOCALES.map((code) => ({
              id: code,
              label: LANGUAGE_NAMES[code],
              icon: code === locale ? ('check' as const) : undefined,
              onSelect: () => setLocale(code),
            })),
          },
        ]}
      />
    </div>
  );
}
