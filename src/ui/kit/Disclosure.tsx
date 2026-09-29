import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

interface Props {
  title: ReactNode;
  /** Shown at the right of the closed summary: a count, a value. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** Detail on demand: a native <details>, so it is keyboard and screen-reader ready, with a hairline instead of a box. */
export function Disclosure({ title, meta, defaultOpen, className, children }: Props) {
  return (
    <details className={cx('disclosure', className)} open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {meta !== undefined && <span className="disclosure__meta">{meta}</span>}
        <Icon name="chevron-down" size={16} className="disclosure__chevron" />
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
