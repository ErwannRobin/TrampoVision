import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { POSITION_TEXT, type MovementLabel } from '../../dataset/movementLabel';
import { useDismiss } from '../hooks';
import { Icon } from '../kit';

/** Half twists as the number of twists, the way a score sheet writes them: 0, ½, 1, 1½, 2. */
export function twistsText(halfTwists: number): string {
  const whole = Math.floor(halfTwists / 2);
  if (halfTwists % 2 === 0) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** What was detected in a jump, one line per part: the somersaults (and their direction), the twists and the position. */
export function detectedRows(m: MovementLabel): { id: string; label: string; value: string }[] {
  const rows = [{ id: 'somersaults', label: t('picker.somersaults'), value: String(m.somersaults) }];
  if (m.somersaults > 0 && m.direction)
    rows.push({ id: 'direction', label: t('picker.direction'), value: t(`dir.${m.direction}`) });
  rows.push(
    { id: 'twists', label: t('picker.twists'), value: twistsText(m.halfTwists) },
    { id: 'position', label: t('picker.position'), value: m.position ? POSITION_TEXT[m.position] : '–' },
  );
  return rows;
}

/**
 * The name of what the classifier saw, with what it is made of in a menu that opens on hover or focus, and stays open when it is pressed
 * (a touch screen has no hover): the number of somersaults, the number of twists and the position.
 */
export function Detected({ movement, children }: { movement: MovementLabel | null; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = hover || focus || pinned;
  const close = useCallback(() => {
    setHover(false);
    setFocus(false);
    setPinned(false);
  }, []);
  useDismiss(root, open, close);

  return (
    <span className="detected" ref={root} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        className="detected__trigger"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={open ? undefined : t('review.detectedHint')}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onClick={() => setPinned((p) => !p)}
      >
        <span className="detected__name">{children}</span>
        <Icon name="info" size={15} className="detected__icon" />
      </button>
      {open && (
        <div className="detected__panel" id={id} role="region" aria-label={t('review.detected')}>
          <h4 className="detected__title">{t('review.detected')}</h4>
          {movement ? (
            <dl className="detected__rows">
              {detectedRows(movement).map((r) => (
                <div key={r.id} className="detected__row">
                  <dt>{r.label}</dt>
                  <dd className="num">{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="detected__none">{t('review.detectedNone')}</p>
          )}
        </div>
      )}
    </span>
  );
}
