import type { ReactNode } from 'react';
import { cx } from './cx';

/** A measurement: the figure large and condensed, its label under it. The unit shrinks next to the figure. */
export function Stat({
  label,
  value,
  unit,
  hint,
  size = 'md',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  size?: 'sm' | 'md' | 'xl';
  className?: string;
}) {
  return (
    <div className={cx('stat', size !== 'md' && `stat--${size}`, className)}>
      <div className="stat__value num">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat__label">{label}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}
