import { describe, expect, it } from 'vitest';
import { matchClip, type ClipIdentity } from './seriesMatch';

const clip = (o: Partial<ClipIdentity> = {}): ClipIdentity => ({ width: 1080, height: 1920, durationS: 30, ...o });

describe('matchClip', () => {
  it('trusts the ids of video files, whatever the athlete suffix', () => {
    expect(matchClip(clip({ videoId: 'v-abc#2' }), clip({ videoId: 'v-abc' }))).toBe('same');
    expect(matchClip(clip({ videoId: 'v-abc' }), clip({ videoId: 'v-def' }))).toBe('different');
  });
  it('does not compare the id of a series without its video', () => {
    expect(matchClip(clip({ videoId: 's-abc' }), clip({ videoId: 'v-def' }))).toBe('unknown');
  });
  it('falls back to the size and the length of the clip', () => {
    expect(matchClip(clip(), clip({ durationS: 29 }))).toBe('unknown');
    expect(matchClip(clip(), clip({ durationS: 45 }))).toBe('different');
    expect(matchClip(clip(), clip({ width: 1920, height: 1080 }))).toBe('different');
    expect(matchClip(clip(), clip({ width: 0, durationS: null }))).toBe('unknown');
  });
});
