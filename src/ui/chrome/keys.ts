/** Input types that do not take typed text: a `?` pressed while one of them has focus is a shortcut, not a character. */
const NO_TEXT_INPUT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}

/** The ? key opens and closes the list of shortcuts, except while the user is typing or holds a command key. */
export function isShortcutsKey(e: KeyEventLike): boolean {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!t) return true;
  if (t.isContentEditable) return false;
  const tag = t.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  return !(tag === 'INPUT' && !NO_TEXT_INPUT.has((t.type ?? 'text').toLowerCase()));
}
