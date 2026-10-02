import { describe, expect, it } from 'vitest';
import { pickDroppedSeries, pickDroppedVideo } from './drop';

const file = (name: string, type = '') => new File([''], name, { type });

describe('pickDroppedVideo', () => {
  it('takes a video by MIME type', () => expect(pickDroppedVideo([file('a.bin', 'video/mp4')])?.name).toBe('a.bin'));
  it('takes an untyped .MOV by extension', () => expect(pickDroppedVideo([file('IMG.MOV')])?.name).toBe('IMG.MOV'));
  it('skips other files', () => {
    expect(pickDroppedVideo([file('a.png', 'image/png'), file('b.mp4')])?.name).toBe('b.mp4');
    expect(pickDroppedVideo([file('a.png', 'image/png')])).toBeNull();
    expect(pickDroppedVideo(null)).toBeNull();
  });
});

describe('pickDroppedSeries', () => {
  it('takes a JSON file by type or extension', () => {
    expect(pickDroppedSeries([file('a.mp4'), file('a-pose-series.json')])?.name).toBe('a-pose-series.json');
    expect(pickDroppedSeries([file('a.bin', 'application/json')])?.name).toBe('a.bin');
    expect(pickDroppedSeries([file('a.mp4')])).toBeNull();
  });
});
