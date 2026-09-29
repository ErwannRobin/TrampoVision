import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Names the group for assistive technology. */
  ariaLabel: string;
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to the width of the container. */
  fill?: boolean;
}

/** One choice out of a few. A thumb slides to the chosen option. Arrow keys move the choice. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel, size = 'md', fill }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let n = 1; n <= options.length; n++) {
      const j = (i + step * n + options.length * n) % options.length;
      if (!options[j].disabled) {
        onChange(options[j].value);
        refs.current[j]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('seg', size !== 'md' && `seg--${size}`, fill && 'seg--fill')}
      style={{ '--n': options.length, '--i': index } as CSSProperties}
    >
      <span className="seg__thumb" aria-hidden="true" />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg__opt"
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.icon && <Icon name={o.icon} size={size === 'sm' ? 13 : 15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
