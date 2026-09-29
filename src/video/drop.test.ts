import { describe, expect, it } from 'vitest';
import { pickDroppedVideo } from './drop';

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
