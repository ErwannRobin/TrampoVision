import { describe, expect, it } from 'vitest';
import { formatBytes, readClips, shortDate, stayText } from './logic';

describe('moderation page', () => {
  it('writes sizes in short units', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(2_500_000)).toBe('2.5 MB');
    expect(formatBytes(48_000_000)).toBe('48 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.50 GB');
  });

  it('says how long a clip stays', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(stayText({ expiresAt: null }, now)).toBe('kept for good');
    expect(stayText({ expiresAt: '2026-10-19T00:00:00Z' }, now)).toBe('3 days left');
    expect(stayText({ expiresAt: '2026-10-17T00:00:00Z' }, now)).toBe('1 day left');
    expect(stayText({ expiresAt: '2026-10-16T13:00:00Z' }, now)).toBe('1 day left');
    expect(stayText({ expiresAt: '2026-10-16T11:00:00Z' }, now)).toBe('expires today');
    expect(stayText({ expiresAt: 'nonsense' }, now)).toBe('');
  });

  it('shows a day', () => {
    expect(shortDate('2026-10-16T12:00:00.000Z')).toBe('2026-10-16');
    expect(shortDate(null)).toBe('');
  });

  it('keeps the well-formed rows of an answer and survives a bad one', () => {
    const answer = readClips({
      clips: [
        { id: 'a', size: 10, createdAt: '2026-10-01T00:00:00Z', expiresAt: null, listed: true, label: 'Final' },
        { id: 'b', size: 'big' },
        null,
        { id: 'c', size: 5, createdAt: '2026-10-02T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', listed: false },
      ],
      totals: { clips: 2, bytes: 15, listed: 1 },
      maxExamples: 40,
    });
    expect(answer.clips.map((c) => c.id)).toEqual(['a', 'c']);
    expect(answer.clips[0]).toMatchObject({ listed: true, label: 'Final', expiresAt: null });
    expect(answer.clips[1]).toMatchObject({ listed: false, label: null, contentType: 'video/mp4' });
    expect(answer.totals).toEqual({ clips: 2, bytes: 15, listed: 1 });
    expect(readClips('x')).toEqual({ clips: [], totals: { clips: 0, bytes: 0, listed: 0 }, maxExamples: 0 });
  });
});
