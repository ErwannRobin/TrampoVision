import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDismiss } from '../hooks';
import { IconButton } from '../kit';
import { isShortcutsKey } from './keys';

const SHORTCUTS: { keys: string[]; text: string }[] = [
  { keys: ['Space'], text: 'Play or pause' },
  { keys: ['←', '→'], text: 'Previous or next frame' },
  { keys: ['Shift', '← →'], text: 'Ten frames at a time' },
  { keys: ['[', ']'], text: 'Previous or next jump' },
  { keys: ['1', '–', '6'], text: 'Label the jump (Review tab)' },
  { keys: ['N'], text: 'Next unlabeled jump (Review tab)' },
  { keys: ['?'], text: 'This list' },
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
        label="Keyboard shortcuts"
        pressed={open}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        tip={open ? false : 'bottom'}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="shortcuts__panel" id={id} role="dialog" aria-label="Keyboard shortcuts">
          <dl className="shortcuts__list">
            {SHORTCUTS.map((s) => (
              <div className="shortcuts__row" key={s.text}>
                <dt>
                  {s.keys.map((k, i) =>
                    k === '–' ? (
                      <span key={i} className="shortcuts__to">
                        to
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
