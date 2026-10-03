import { describe, expect, it } from 'vitest';
import { APP_WITH_RESULT, handoffWaiting, withoutHandoff } from './handoff';

describe('the address the motion page sends the person to', () => {
  it('says that a video is waiting', () => {
    expect(handoffWaiting(new URL(APP_WITH_RESULT, 'https://example.org').search)).toBe(true);
    expect(handoffWaiting('?from=motion')).toBe(true);
    expect(handoffWaiting('?x=1&from=motion')).toBe(true);
  });

  it('is not mistaken for another address', () => {
    expect(handoffWaiting('')).toBe(false);
    expect(handoffWaiting('?from=review')).toBe(false);
    expect(handoffWaiting('?from=motions')).toBe(false);
    expect(handoffWaiting('?motion')).toBe(false);
  });

  it('goes to the app itself, not to a page of its own', () => {
    const url = new URL(APP_WITH_RESULT, 'https://example.org');
    expect(url.pathname).toBe('/');
  });
});

describe('the address once the video was taken', () => {
  it('has no mark and no question mark left, so a reload does not look for the video again', () => {
    expect(withoutHandoff('?from=motion')).toBe('');
  });

  it('keeps what else was in the address', () => {
    expect(withoutHandoff('?x=1&from=motion')).toBe('?x=1');
    expect(withoutHandoff('?from=motion&x=1&y=2')).toBe('?x=1&y=2');
  });

  it('leaves an address that never had the mark exactly as it was', () => {
    expect(withoutHandoff('')).toBe('');
    expect(withoutHandoff('?from=review')).toBe('?from=review');
    expect(withoutHandoff('?a=%20b')).toBe('?a=%20b');
  });
});
