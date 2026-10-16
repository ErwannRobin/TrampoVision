import { describe, expect, it } from 'vitest';
import { readBundle, writeBundle } from './bundle';

/** One box: 4-byte size, 4-character type, then `content` bytes of filler. */
function box(type: string, content: number, size = 8 + content): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(8 + content);
  new DataView(b.buffer).setUint32(0, size);
  b.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  for (let i = 8; i < b.length; i++) b[i] = (i * 7) % 251;
  return b;
}

/** A small MP4: ftyp, mdat, moov (as an iPhone writes it, the index last). */
const mp4 = () => new Blob([box('ftyp', 24), box('mdat', 5000), box('moov', 600)], { type: 'video/mp4' });
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const SERIES = JSON.stringify({ schema: 'trampovision.pose-series', version: 1, frames: [{ t: 0 }], note: 'é ü 日本' });

describe('video with its analysis inside', () => {
  it('gives back the video, byte for byte, and the analysis', async () => {
    const video = mp4();
    const bundle = await writeBundle(video, SERIES);
    expect(bundle.size).toBeGreaterThan(video.size);
    expect(bundle.type).toBe('video/mp4');
    const read = await readBundle(bundle);
    expect(read.series).toBe(SERIES);
    expect(await bytes(read.video)).toEqual(await bytes(video));
    expect(read.video.type).toBe('video/mp4');
  });

  it('keeps the file a row of boxes, the analysis being the last one', async () => {
    const bundle = await bytes(await writeBundle(mp4(), SERIES));
    const view = new DataView(bundle.buffer);
    const types: string[] = [];
    for (let at = 0; at < bundle.length; at += view.getUint32(at)) {
      types.push(String.fromCharCode(...bundle.subarray(at + 4, at + 8)));
    }
    expect(types).toEqual(['ftyp', 'mdat', 'moov', 'uuid']);
  });

  it('replaces the analysis of a file that already has one', async () => {
    const once = await writeBundle(mp4(), SERIES);
    const twice = await writeBundle(once, '{"other":true}');
    expect(twice.size).toBeLessThan(once.size);
    const read = await readBundle(twice);
    expect(read.series).toBe('{"other":true}');
    expect(await bytes(read.video)).toEqual(await bytes(mp4()));
  });

  it('reads a plain video, or a file that is no video, as it is', async () => {
    const plain = mp4();
    expect(await readBundle(plain)).toEqual({ video: plain, series: null });
    const text = new Blob(['not a video at all, just text']);
    expect((await readBundle(text)).series).toBe(null);
    expect((await readBundle(new Blob([]))).series).toBe(null);
  });

  it('reads a box with a 64-bit size', async () => {
    const big = new Uint8Array(16 + 40);
    const view = new DataView(big.buffer);
    view.setUint32(0, 1);
    big.set([0x6d, 0x64, 0x61, 0x74], 4); // mdat
    view.setBigUint64(8, BigInt(big.length));
    const bundle = await writeBundle(new Blob([box('ftyp', 24), big, box('moov', 100)]), SERIES);
    expect((await readBundle(bundle)).series).toBe(SERIES);
  });

  it('refuses a file whose last box runs to its end, and a file that is no video', async () => {
    const open = new Blob([box('ftyp', 24), box('mdat', 500, 0)]);
    await expect(writeBundle(open, SERIES)).rejects.toThrow();
    await expect(writeBundle(new Blob(['hello']), SERIES)).rejects.toThrow();
  });

  it('leaves alone an analysis box that is not the last one, and a damaged one', async () => {
    const bundle = await bytes(await writeBundle(mp4(), SERIES));
    const after = new Blob([bundle, box('free', 10)]);
    const read = await readBundle(after);
    expect(read.series).toBe(SERIES);
    expect(read.video).toBe(after);

    const damaged = bundle.slice();
    damaged.fill(0, damaged.length - 20);
    expect((await readBundle(new Blob([damaged]))).series).toBe(null);
  });
});
