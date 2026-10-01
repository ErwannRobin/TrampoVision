import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useDismiss } from '../hooks';
import { IconButton } from '../kit';
import { isShortcutsKey } from './keys';

const shortcuts = (): { keys: string[]; text: string }[] => [
  { keys: ['Space'], text: t('shortcuts.playPause') },
  { keys: ['←', '→'], text: t('shortcuts.frame') },
  { keys: ['Shift', '← →'], text: t('shortcuts.tenFrames') },
  { keys: ['[', ']'], text: t('shortcuts.jump') },
  { keys: ['0', '–', '3'], text: t('shortcuts.label') },
  { keys: ['Enter'], text: t('shortcuts.accept') },
  { keys: ['U'], text: t('shortcuts.cannotTell') },
  { keys: ['Z'], text: t('shortcuts.undo') },
  { keys: ['N'], text: t('shortcuts.nextUnlabeled') },
  { keys: ['?'], text: t('shortcuts.list') },
];

/** The keyboard shortcuts of the app. The ? key opens and closes it. */
export function ShortcutsPopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutsKey(e)) setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shortcuts" ref={root}>
      <IconButton
        icon="keyboard"
        label={t('shortcuts.title')}
        pressed={open}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        tip={open ? false : 'bottom'}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="shortcuts__panel" id={id} role="dialog" aria-label={t('shortcuts.title')}>
          <dl className="shortcuts__list">
            {shortcuts().map((s) => (
              <div className="shortcuts__row" key={s.text}>
                <dt>
                  {s.keys.map((k, i) =>
                    k === '–' ? (
                      <span key={i} className="shortcuts__to">
                        {t('shortcuts.to')}
                      </span>
                    ) : (
                      <kbd key={i}>{k}</kbd>
                    ),
                  )}
                </dt>
                <dd>{s.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
