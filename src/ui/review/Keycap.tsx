import type { ReactNode } from 'react';

/** A key of the keyboard, shown on the control it presses. Hidden on touch screens, where there is no keyboard. */
export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="review-keycap num" aria-hidden="true">
      {children}
    </kbd>
  );
}
