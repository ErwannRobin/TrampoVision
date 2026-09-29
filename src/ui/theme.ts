import type { Pose3DColors } from '../pose3d/draw';
import { useEffect, useState } from 'react';

/** Canvas can't use CSS variables directly: read them (and re-read when the OS theme flips). */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setV((x) => x + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

export function cssVar(name: string, fallback = '#888'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Colors of the 3D skeleton drawing in the current theme. */
export const pose3dColors = (): Pose3DColors => ({
  ink: cssVar('--text'),
  soft: cssVar('--text-2'),
  left: cssVar('--series-1'),
  right: cssVar('--series-2'),
  grid: cssVar('--grid'),
});
