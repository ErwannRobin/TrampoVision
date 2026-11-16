import { describe, expect, it } from 'vitest';
import { releaseDate, shortCommit } from './version';

describe('version', () => {
  it('shows the first 7 characters of a commit', () => {
    expect(shortCommit('1e8a784f186407aaa78f122372b68eb1a3665a46')).toBe('1e8a784');
    expect(shortCommit('')).toBe('');
  });

  it('writes the release date in the reader’s language, on the UTC day of the build', () => {
    expect(releaseDate('2026-11-16T00:04:44.000Z', 'en')).toBe('November 16, 2026');
    expect(releaseDate('2026-11-16T00:04:44.000Z', 'fr')).toBe('16 novembre 2026');
  });

  it('has no date when the build has none, or one that cannot be read', () => {
    expect(releaseDate('', 'en')).toBeNull();
    expect(releaseDate('not a date', 'en')).toBeNull();
  });
});
