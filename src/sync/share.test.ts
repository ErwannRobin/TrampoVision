import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetShare, rememberShare, rememberedShare, shareIdFrom, shareLink, withoutShare } from './share';

const ID = 'nUUB685eR6a0vTE-Iu5rIQ';

describe('share link', () => {
  it('opens the clip from the address, and only a well-formed id', () => {
    const link = shareLink(ID, 'https://trampo-vision.vercel.app/');
    expect(link).toBe(`https://trampo-vision.vercel.app/?share=${ID}`);
    expect(shareIdFrom(new URL(link).search)).toBe(ID);
    expect(shareIdFrom('?share=../../x')).toBe(null);
    expect(shareIdFrom('?other=1')).toBe(null);
  });

  it('drops the shared clip from the address and keeps the rest', () => {
    expect(withoutShare(`?share=${ID}`)).toBe('');
    expect(withoutShare(`?lang=fr&share=${ID}`)).toBe('?lang=fr');
  });
});

describe('links made on this device', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  });
  afterEach(() => store.clear());

  it('gives back the link of a clip until it expires', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    rememberShare('v-1', { id: ID, expiresAt: '2027-01-13T12:00:00Z', deleteKey: 'k' }, now);
    expect(rememberedShare('v-1', now)).toMatchObject({ id: ID, deleteKey: 'k' });
    expect(rememberedShare('v-1', Date.parse('2027-02-01T00:00:00Z'))).toBe(null);
    expect(rememberedShare('v-2', now)).toBe(null);
    forgetShare('v-1');
    expect(rememberedShare('v-1', now)).toBe(null);
  });

  it('drops the expired links when it keeps a new one, and survives a damaged store', () => {
    rememberShare('old', { id: ID, expiresAt: '2026-01-01T00:00:00Z' }, Date.parse('2025-12-01T00:00:00Z'));
    rememberShare('new', { id: ID, expiresAt: '2027-01-01T00:00:00Z' }, Date.parse('2026-10-15T00:00:00Z'));
    expect(Object.keys(JSON.parse(store.get('trampovision.shares')!))).toEqual(['new']);
    store.set('trampovision.shares', 'not json');
    expect(rememberedShare('new')).toBe(null);
  });
});
