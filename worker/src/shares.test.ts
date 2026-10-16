import { describe, expect, it } from 'vitest';
import {
  checkUpload,
  contentRange,
  isShareId,
  looksLikeVideo,
  randomToken,
  sha256Hex,
  DAILY_SHARE_BYTES,
  MAX_LIVE_SHARE_BYTES,
  MAX_SHARE_BYTES,
} from './shares';

const empty = { lastDay: 0, live: 0 };

describe('shared clips', () => {
  it('makes ids of 22 url-safe characters, a new one each time', () => {
    const a = randomToken(16);
    expect(isShareId(a)).toBe(true);
    expect(a).not.toBe(randomToken(16));
    expect(isShareId('short')).toBe(false);
    expect(isShareId('../../../etc/passwd....')).toBe(false);
  });

  it('accepts an MP4 or QuickTime video of a known size', () => {
    expect(checkUpload('video/mp4', '1000', empty)).toEqual({ ok: true, value: { type: 'video/mp4', size: 1000 } });
    expect(checkUpload('video/QuickTime; codecs=x', '5', empty)).toMatchObject({
      ok: true,
      value: { type: 'video/quicktime' },
    });
  });

  it.each([
    ['another type', 'text/html', '10', empty, 415],
    ['no type', null, '10', empty, 415],
    ['no size', 'video/mp4', null, empty, 411],
    ['a size that is no number', 'video/mp4', 'ten', empty, 411],
    ['too large a file', 'video/mp4', String(MAX_SHARE_BYTES + 1), empty, 413],
    ['a full day', 'video/mp4', '10', { lastDay: DAILY_SHARE_BYTES, live: 0 }, 503],
    ['a full bucket', 'video/mp4', '10', { lastDay: 0, live: MAX_LIVE_SHARE_BYTES }, 503],
  ])('refuses %s', (_, type, length, usage, status) => {
    expect(checkUpload(type, length, usage)).toMatchObject({ ok: false, status });
  });

  it('knows the first box of a video', () => {
    const head = (type: string) => new Uint8Array([0, 0, 0, 32, ...[...type].map((c) => c.charCodeAt(0))]);
    expect(looksLikeVideo(head('ftyp'))).toBe(true);
    expect(looksLikeVideo(head('wide'))).toBe(true);
    expect(looksLikeVideo(new TextEncoder().encode('<html><body>'))).toBe(false);
    expect(looksLikeVideo(new Uint8Array(3))).toBe(false);
  });

  it('writes the range that was served', () => {
    expect(contentRange({ offset: 0, length: 100 }, 1000)).toBe('bytes 0-99/1000');
    expect(contentRange({ offset: 900 }, 1000)).toBe('bytes 900-999/1000');
    expect(contentRange({ offset: 900, length: 500 }, 1000)).toBe('bytes 900-999/1000');
    expect(contentRange({ suffix: 10 }, 1000)).toBe('bytes 990-999/1000');
  });

  it('hashes the delete key', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
