/** Labels longer than this get the smaller headline, so that a long skill name wraps in two lines instead of three. */
const LONG_LABEL = 16;

export const headlineSize = (label: string): 'lg' | 'md' => (label.length > LONG_LABEL ? 'md' : 'lg');

/** A share of the best jump of the clip (0..1) as a CSS width. */
export function barWidth(share: number): string {
  const clamped = Number.isFinite(share) ? Math.min(Math.max(share, 0), 1) : 0;
  return `${Math.round(clamped * 1000) / 10}%`;
}

interface Span {
  top: number;
  bottom: number;
}

/**
 * The scrollTop that brings `item` inside `view` with `margin` to spare, or null when it is already there. Both boxes
 * are client rects (the same coordinate space). An item taller than the room is aligned to the top.
 */
export function scrollTopToReveal(view: Span, item: Span, scrollTop: number, margin = 0): number | null {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (item.top < top || item.bottom - item.top > bottom - top) return Math.max(0, scrollTop + item.top - top);
  if (item.bottom > bottom) return Math.max(0, scrollTop + item.bottom - bottom);
  return null;
}

/** The row to focus for an arrow, Home or End key inside a list of `count` rows; null for any other key. */
export function focusTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(current + 1, count - 1);
    case 'ArrowUp':
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
