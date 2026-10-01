import { useCallback, useEffect, useState } from 'react';

export const REVIEW_HASH = '#review';

const isReview = () => window.location.hash === REVIEW_HASH;

/**
 * Whether the review mode is open. Like the About page it lives in the address (`#review`), so it can be linked and the back button
 * leaves it. Opening adds a history entry; closing replaces the address, so nothing is left behind.
 */
export function useReviewRoute(): [open: boolean, setOpen: (open: boolean) => void] {
  const [open, setOpenState] = useState(isReview);
  useEffect(() => {
    const sync = () => setOpenState(isReview());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (next) window.location.hash = REVIEW_HASH;
    else if (isReview()) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setOpenState(next);
  }, []);
  return [open, setOpen];
}
