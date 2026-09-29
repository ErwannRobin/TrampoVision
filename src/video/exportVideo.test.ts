import { describe, expect, it } from 'vitest';
import { exportSize } from './exportVideo';

describe('exportSize', () => {
  it('keeps small videos as they are', () => {
    expect(exportSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('rounds to even dimensions', () => {
    expect(exportSize(853, 481)).toEqual({ width: 854, height: 482 });
  });

  it('scales large videos down to 1920 on the long side, portrait included', () => {
    expect(exportSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(exportSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
  });
});
