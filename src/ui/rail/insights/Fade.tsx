import type { ReactNode } from 'react';
import { cx } from '../../kit';

/**
 * Content that crossfades when the selected jump changes: a new key remounts it and it fades in. Only the content sits
 * inside, never a hairline or a control, so the separators stay put and a focused button is not lost to a remount.
 */
export function Fade({ on, className, children }: { on: number; className?: string; children: ReactNode }) {
  return (
    <div key={on} className={cx('ins-fade', className)}>
      {children}
    </div>
  );
}
