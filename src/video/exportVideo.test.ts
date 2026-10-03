import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSize, pickConfig } from './exportVideo';

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

/** A browser whose video encoder knows the codecs that start with one of `prefixes`. */
function encoderThatKnows(...prefixes: string[]) {
  const asked: string[] = [];
  vi.stubGlobal('VideoEncoder', {
    isConfigSupported: async (config: { codec: string }) => {
      asked.push(config.codec);
      return { supported: prefixes.some((p) => config.codec.startsWith(p)) };
    },
  });
  return asked;
}

describe('the codec of an exported video', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is H.264 when the browser can encode it, whether or not VP9 is allowed', async () => {
    encoderThatKnows('avc1', 'vp09');
    expect((await pickConfig(1280, 720, 30)).container).toBe('avc');
    expect((await pickConfig(1280, 720, 30, true)).container).toBe('avc');
  });

  it('is never VP9 unless the caller allows it: the exports are made to be shared', async () => {
    const asked = encoderThatKnows('vp09');
    await expect(pickConfig(1280, 720, 30)).rejects.toThrow('H.264');
    expect(asked.some((codec) => codec.startsWith('vp09'))).toBe(false);
  });

  it('is VP9, in the MP4, where there is no H.264 encoder and the caller allows it', async () => {
    encoderThatKnows('vp09');
    const { config, container } = await pickConfig(1280, 720, 30, true);
    expect(container).toBe('vp9');
    expect(config.codec).toMatch(/^vp09\./);
  });

  it('asks for the size and the frame rate it was given', async () => {
    encoderThatKnows('avc1');
    const { config } = await pickConfig(1920, 1080, 30);
    expect([config.width, config.height, config.framerate]).toEqual([1920, 1080, 30]);
  });

  it('fails when the browser can encode neither', async () => {
    encoderThatKnows();
    await expect(pickConfig(1280, 720, 30, true)).rejects.toThrow('H.264');
  });
});
