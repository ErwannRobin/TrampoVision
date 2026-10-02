import { describe, expect, it } from 'vitest';
import { decodesHevcMov, pickSample, samplesFromFiles } from './sample';

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const paths = ['https://blob.example/IMG_8368.MOV', 'https://blob.example/IMG_8368.mp4'];

describe('sample video choice', () => {
  it('detects desktop Safari only', () => {
    expect(decodesHevcMov(SAFARI, 0)).toBe(true);
    expect(decodesHevcMov(IOS_SAFARI, 5)).toBe(false);
    expect(decodesHevcMov(SAFARI, 5)).toBe(false); // iPad in desktop mode
    expect(decodesHevcMov(CHROME)).toBe(false);
    expect(decodesHevcMov(IOS_CHROME)).toBe(false);
  });

  it('picks the .mov for desktop Safari and the .mp4 elsewhere', () => {
    expect(pickSample(paths, SAFARI, 0)).toMatch(/\.MOV$/);
    expect(pickSample(paths, IOS_SAFARI, 5)).toMatch(/\.mp4$/);
    expect(pickSample(paths, CHROME)).toMatch(/\.mp4$/);
  });

  it('falls back to the .mp4 when there is no .mov, and to null when empty', () => {
    expect(pickSample([paths[1]], SAFARI, 0)).toMatch(/\.mp4$/);
    expect(pickSample([], SAFARI, 0)).toBeNull();
  });
});

describe('sample list from the store index', () => {
  const files = ['synchro.mp4', 'IMG_8368.MOV', 'IMG_8368.mp4', 'notes.txt', 'dong-dong_2011.mp4'];

  it('makes one clip per name, sorted, skipping non-videos', () => {
    const list = samplesFromFiles('https://blob.example/', files, CHROME);
    expect(list.map((s) => s.id)).toEqual(['dong-dong_2011', 'IMG_8368', 'synchro']);
    expect(list.map((s) => s.label)).toEqual(['dong dong 2011', 'IMG 8368', 'synchro']);
  });

  it('gives each clip the file its browser decodes', () => {
    expect(samplesFromFiles('https://blob.example/', files, SAFARI, 0)[1].path).toBe(
      'https://blob.example/samples/IMG_8368.MOV',
    );
    expect(samplesFromFiles('https://blob.example/', files, CHROME)[1].path).toBe(
      'https://blob.example/samples/IMG_8368.mp4',
    );
  });

  it('is empty for an empty index', () => {
    expect(samplesFromFiles('https://blob.example/', [])).toEqual([]);
  });

  it('attaches the saved analysis of a clip, and ignores one with no video', () => {
    const list = samplesFromFiles(
      'https://blob.example/',
      ['synchro.mp4', 'synchro.pose.json', 'portrait.mp4', 'orphan.pose.json', 'index.json'],
      CHROME,
    );
    expect(list.map((s) => s.id)).toEqual(['portrait', 'synchro']);
    expect(list[0].series).toBeUndefined();
    expect(list[1].series).toBe('https://blob.example/samples/synchro.pose.json');
  });
});
