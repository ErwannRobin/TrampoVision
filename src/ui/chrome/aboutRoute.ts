import { useCallback, useEffect, useState } from 'react';

export const ABOUT_HASH = '#about';

const isAbout = () => window.location.hash === ABOUT_HASH;

/**
 * Whether the About page is open. It lives in the address (`#about`), so it can be linked and the back button closes it.
 * Opening adds a history entry; closing replaces the address, so nothing is left behind.
 */
export function useAbout(): [open: boolean, setOpen: (open: boolean) => void] {
  const [open, setOpenState] = useState(isAbout);
  useEffect(() => {
    const sync = () => setOpenState(isAbout());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (next) window.location.hash = ABOUT_HASH;
    else if (isAbout()) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setOpenState(next);
    if (next) window.scrollTo(0, 0);
  }, []);
  return [open, setOpen];
}
