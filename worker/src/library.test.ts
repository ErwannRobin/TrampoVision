import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../../src/analysis/computeAnalysis';
import { syntheticRoutine } from '../../src/analysis/testTracks';
import { buildPoseSeries, toSeriesJson } from '../../src/analysis/timeSeries';
import { readSeries } from '../../src/library/best';
import { gunzipLimited, isVideoId, mismatch, readIndex, seriesKey, videoKey } from './library';

const track = syntheticRoutine({
  jumps: Array.from({ length: 6 }, () => ({ v0: 5 })),
  leadInS: 0.2,
  contactS: 0.3,
}).track;
const text = toSeriesJson(
  buildPoseSeries(computeAnalysis(track), track, {
    fileName: 'a.mp4',
    videoId: 'v-0123456789ab',
    stride: 1,
    minVisibility: 0.4,
    calibration: null,
  }),
);
const gzip = async (s: string) =>
  new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
const lengthS = track.times.at(-1)!;

describe('the library keys', () => {
  it('names a video, its analysis and the ids it accepts', () => {
    expect(videoKey('v-0123456789ab')).toBe('library/v-0123456789ab.mp4');
    expect(seriesKey('v-0123456789ab', 3)).toBe('library/v-0123456789ab.3.series.gz');
    expect(isVideoId('v-0123456789ab')).toBe(true);
    for (const bad of ['v-0123456789a', 'v-0123456789ABC', '../index', 'v-0123456789ab.mp4', '']) {
      expect(isVideoId(bad)).toBe(false);
    }
  });
});

describe('an uploaded analysis', () => {
  it('is read back from gzip, up to a limit', async () => {
    expect(await gunzipLimited(await gzip(text), text.length + 10)).toBe(text);
    expect(await gunzipLimited(await gzip(text), 1000)).toBeNull();
    expect(await gunzipLimited(new TextEncoder().encode('not gzip').buffer as ArrayBuffer, 1000)).toBeNull();
  });

  it('must be of the video it is sent for, and cover it', () => {
    const reading = readSeries(text);
    expect(mismatch(reading, 'v-0123456789ab', lengthS)).toBeNull();
    expect(mismatch(reading, 'v-0123456789ab', undefined)).toBeNull();
    expect(mismatch(reading, 'v-ffffffffffff', lengthS)).toMatch(/not of this video/);
    // Half the clip, or a clip much shorter than the analysis.
    expect(mismatch(reading, 'v-0123456789ab', lengthS * 2 + 10)).toMatch(/does not cover/);
    expect(mismatch(reading, 'v-0123456789ab', lengthS / 3)).toMatch(/does not cover/);
  });
});

describe('the list of videos', () => {
  const bucket = (body: unknown) =>
    ({ SHARES: { get: async () => (body === null ? null : { json: async () => body }) } }) as never;

  it('keeps the entries that name a video and a title', async () => {
    const clips = [
      { id: 'v-0123456789ab', title: 'A', size: 1 },
      { id: 'nope', title: 'B', size: 1 },
      { id: 'v-0123456789ac', title: '', size: 1 },
      null,
    ];
    expect((await readIndex(bucket({ clips }))).map((c) => c.id)).toEqual(['v-0123456789ab']);
  });

  it('is empty before the first upload, or when the file is not a list', async () => {
    expect(await readIndex(bucket(null))).toEqual([]);
    expect(await readIndex(bucket({ clips: 3 }))).toEqual([]);
  });
});
