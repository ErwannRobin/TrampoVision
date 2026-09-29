import { describe, expect, it } from 'vitest';
import { decodesHevcMov, pickSample } from './sample';

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const paths = ['../../video-sample/IMG_8368.MOV', '../../video-sample/IMG_8368.mp4'];

describe('sample video choice', () => {
  it('detects Safari only', () => {
    expect(decodesHevcMov(SAFARI)).toBe(true);
    expect(decodesHevcMov(CHROME)).toBe(false);
    expect(decodesHevcMov(IOS_CHROME)).toBe(false);
  });

  it('picks the .mov for Safari and the .mp4 elsewhere', () => {
    expect(pickSample(paths, SAFARI)).toMatch(/\.MOV$/);
    expect(pickSample(paths, CHROME)).toMatch(/\.mp4$/);
  });

  it('falls back to the .mp4 when there is no .mov, and to null when empty', () => {
    expect(pickSample([paths[1]], SAFARI)).toMatch(/\.mp4$/);
    expect(pickSample([], SAFARI)).toBeNull();
  });
});
