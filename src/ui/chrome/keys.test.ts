import { describe, expect, it } from 'vitest';
import { isShortcutsKey } from './keys';

const press = (key: string, target: unknown = { tagName: 'BODY' }, mods: Partial<Record<string, boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
  target,
});

describe('isShortcutsKey', () => {
  it('answers to the question mark anywhere on the page', () => {
    expect(isShortcutsKey(press('?'))).toBe(true);
    expect(isShortcutsKey(press('?', null))).toBe(true);
    expect(isShortcutsKey(press('?', { tagName: 'BUTTON' }))).toBe(true);
  });

  it('ignores every other key', () => {
    expect(isShortcutsKey(press('/'))).toBe(false);
    expect(isShortcutsKey(press('Escape'))).toBe(false);
  });

  it('stays out of the way while the user types', () => {
    expect(isShortcutsKey(press('?', { tagName: 'INPUT', type: 'text' }))).toBe(false);
    expect(isShortcutsKey(press('?', { tagName: 'INPUT', type: 'number' }))).toBe(false);
    expect(isShortcutsKey(press('?', { tagName: 'INPUT' }))).toBe(false);
    expect(isShortcutsKey(press('?', { tagName: 'TEXTAREA' }))).toBe(false);
    expect(isShortcutsKey(press('?', { tagName: 'SELECT' }))).toBe(false);
    expect(isShortcutsKey(press('?', { tagName: 'DIV', isContentEditable: true }))).toBe(false);
  });

  it('still works from a checkbox or a file input, where nothing is typed', () => {
    expect(isShortcutsKey(press('?', { tagName: 'INPUT', type: 'checkbox' }))).toBe(true);
    expect(isShortcutsKey(press('?', { tagName: 'INPUT', type: 'file' }))).toBe(true);
  });

  it('leaves command combinations to the browser', () => {
    expect(isShortcutsKey(press('?', undefined, { ctrlKey: true }))).toBe(false);
    expect(isShortcutsKey(press('?', undefined, { metaKey: true }))).toBe(false);
    expect(isShortcutsKey(press('?', undefined, { altKey: true }))).toBe(false);
  });
});
