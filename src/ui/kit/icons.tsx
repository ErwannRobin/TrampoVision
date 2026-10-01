import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * One consistent set of line icons (24px grid, 1.75 stroke, round caps). Solid shapes (play, pause, dots) fill with the
 * current text color. Icons are decoration: give the button that holds one an accessible name.
 */
const ICONS = {
  play: <polygon points="7 4.5 19.5 12 7 19.5" fill="currentColor" strokeWidth="1.6" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  'step-back': (
    <>
      <line x1="6" y1="5" x2="6" y2="19" />
      <polyline points="18 5 10 12 18 19" />
    </>
  ),
  'step-forward': (
    <>
      <line x1="18" y1="5" x2="18" y2="19" />
      <polyline points="6 5 14 12 6 19" />
    </>
  ),
  'play-reverse': <polygon points="17 4.5 4.5 12 17 19.5" fill="currentColor" strokeWidth="1.6" />,
  'skip-start': (
    <>
      <line x1="4.5" y1="5" x2="4.5" y2="19" />
      <polyline points="12.5 5 6.5 12 12.5 19" />
      <polyline points="19.5 5 13.5 12 19.5 19" />
    </>
  ),
  flag: (
    <>
      <line x1="5.5" y1="21" x2="5.5" y2="3.5" />
      <path d="M5.5 4.5h12l-2.6 4 2.6 4h-12" fill="currentColor" strokeWidth="1.6" />
    </>
  ),
  'chevron-left': <polyline points="15 5 8 12 15 19" />,
  'chevron-right': <polyline points="9 5 16 12 9 19" />,
  'chevron-up': <polyline points="5 15 12 8 19 15" />,
  'chevron-down': <polyline points="5 9 12 16 19 9" />,
  loop: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <polyline points="7 11 12 16 17 11" />
      <path d="M5 20h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V5" />
      <polyline points="7 9 12 4 17 9" />
      <path d="M5 20h14" />
    </>
  ),
  sliders: (
    <>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" fill="currentColor" />
      <circle cx="15" cy="16" r="2.4" fill="currentColor" />
    </>
  ),
  gear: (
    <>
      <path d="M10.44 4.97 L10.69 2.69 L13.31 2.69 L13.56 4.97 A7.2 7.2 0 0 1 15.87 5.93 L17.66 4.49 L19.51 6.34 L18.07 8.13 A7.2 7.2 0 0 1 19.03 10.44 L21.31 10.69 L21.31 13.31 L19.03 13.56 A7.2 7.2 0 0 1 18.07 15.87 L19.51 17.66 L17.66 19.51 L15.87 18.07 A7.2 7.2 0 0 1 13.56 19.03 L13.31 21.31 L10.69 21.31 L10.44 19.03 A7.2 7.2 0 0 1 8.13 18.07 L6.34 19.51 L4.49 17.66 L5.93 15.87 A7.2 7.2 0 0 1 4.97 13.56 L2.69 13.31 L2.69 10.69 L4.97 10.44 A7.2 7.2 0 0 1 5.93 8.13 L4.49 6.34 L6.34 4.49 L8.13 5.93 A7.2 7.2 0 0 1 10.44 4.97 Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  check: <polyline points="5 12.5 10 17.5 19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.6" x2="12.01" y2="7.6" strokeWidth="2.4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.6 2.9 19.4h18.2Z" />
      <line x1="12" y1="10" x2="12" y2="14.4" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.6" />
      <path d="m16 10.4 5-2.4v8l-5-2.4" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9h4.5M3.5 15h4.5M16 9h4.5M16 15h4.5" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 3.5 21 8.5 12 13.5 3 8.5" />
      <polyline points="3 12.5 12 17.5 21 12.5" />
      <polyline points="3 16.5 12 21.5 21 16.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.8" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9a1 1 0 0 1 .7.3l7.2 7.2a1 1 0 0 1 0 1.4l-7.9 7.9a1 1 0 0 1-1.4 0l-7.2-7.2a1 1 0 0 1-.3-.7Z" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <path d="M12 8v6M12 10 7 7.6M12 10l5-2.4M12 14l-3.5 6M12 14l3.5 6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.6" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.6" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4" />
      <polyline points="5.5 3 5.5 7 9.5 7" />
      <path d="M4 13a8 8 0 0 0 14.5 4" />
      <polyline points="18.5 21 18.5 17 14.5 17" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="m6.5 7 1 13h9l1-13" />
    </>
  ),
  bed: (
    <>
      <path d="M5 9 19 7.5l2 9.5L3.5 18.5Z" />
      <circle cx="5" cy="9" r="1.3" fill="currentColor" />
      <circle cx="19" cy="7.5" r="1.3" fill="currentColor" />
      <circle cx="21" cy="17" r="1.3" fill="currentColor" />
      <circle cx="3.5" cy="18.5" r="1.3" fill="currentColor" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6Z" />
      <polyline points="9 12 11.2 14.2 15 10" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
