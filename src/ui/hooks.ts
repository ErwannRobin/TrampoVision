import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** State kept in localStorage for one viewer's convenience. Storage can be missing or full: then it just is not remembered. */
export function useLocalStorage<T extends string>(key: string, initial: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw))) return raw as T;
    } catch {
      /* storage unavailable */
    }
    return initial;
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set] as const;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Size of an element's content box, kept current with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Whether an element is at least `min` pixels wide. Known before the first paint, so a layout chosen by it does not flash. */
export function useMinWidth<T extends HTMLElement>(ref: RefObject<T | null>, min: number): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.getBoundingClientRect().width >= min);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}

/** Calls `onClose` for a pointer press outside `ref` and for Escape, while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [ref, active, onClose]);
}
