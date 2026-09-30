import { LANGUAGE_NAMES, LOCALES, setLocale, t, useLocale } from '../i18n';
import { Menu } from './kit';

/** The language of the interface: the current one on the button, every one in the list, each in its own language. */
export function LanguageMenu({ compact }: { compact: boolean }) {
  const locale = useLocale();
  return (
    <Menu
      label={compact ? t('language.switch') : LANGUAGE_NAMES[locale]}
      icon="globe"
      iconOnly={compact}
      variant="ghost"
      size="sm"
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
  );
}
