import { t } from '../i18n/core';

/**
 * A clip with its analysis inside: one file (or one link) that opens already analyzed, with no pose model to run.
 *
 * An MP4 or QuickTime file is a row of boxes (size, type, content). The saved analysis (the "Save analysis (JSON)" text,
 * gzipped) goes in one more box after the last one, a `uuid` box with TrampoVision's own type. Players skip a box they do not
 * know, so the file still plays anywhere as a plain video. Cutting the box off gives back the original bytes, so the clip
 * keeps its id (dataset/videoId) and its labels and recent set still match.
 *
 * Layout of the box: size (4 bytes) | "uuid" | USER_TYPE (16 bytes) | gzip of the JSON.
 */

/** "trampovision", then the version of this layout. */
const USER_TYPE = new Uint8Array([
  0x74, 0x72, 0x61, 0x6d, 0x70, 0x6f, 0x76, 0x69, 0x73, 0x69, 0x6f, 0x6e, 0x00, 0x00, 0x00, 0x01,
]);
const HEADER = 8 + USER_TYPE.length;
/** A video has a handful of top-level boxes: past this many, the file is not one. */
const MAX_BOXES = 4096;

interface Box {
  type: string;
  start: number;
  end: number;
  /** The last box of a file may say "to the end of the file" (size 0) instead of its size. */
  toEnd: boolean;
  /** For a `uuid` box: whether it is TrampoVision's. */
  ours: boolean;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Where the bytes of a file come from: a Blob in the browser, or ranges of a file on a server (see the moderation page). */
export interface ByteSource {
  size: number;
  /** The bytes from `start` to `end` (excluded), `end` at most `size`. */
  read(start: number, end: number): Promise<Blob>;
}

const blobSource = (file: Blob): ByteSource => ({
  size: file.size,
  read: async (start, end) => file.slice(start, end),
});

/** The top-level boxes of the file, or null when it is not a row of boxes that ends exactly at the end of the file. */
async function scanBoxes(file: ByteSource): Promise<Box[] | null> {
  const boxes: Box[] = [];
  let at = 0;
  while (at < file.size) {
    if (file.size - at < 8 || boxes.length >= MAX_BOXES) return null;
    const head = new Uint8Array(await (await file.read(at, Math.min(at + 32, file.size))).arrayBuffer());
    const view = new DataView(head.buffer);
    let size = view.getUint32(0);
    const type = String.fromCharCode(...head.subarray(4, 8));
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    }
    const toEnd = size === 0;
    if (toEnd) size = file.size - at;
    if (size < headerSize || at + size > file.size) return null;
    const ours =
      type === 'uuid' &&
      head.length >= headerSize + 16 &&
      sameBytes(head.subarray(headerSize, headerSize + 16), USER_TYPE);
    boxes.push({ type, start: at, end: at + size, toEnd, ours });
    at += size;
  }
  return boxes.length ? boxes : null;
}

export const gzip = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  );

export const gunzip = (data: Blob): Promise<string> =>
  new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();

export interface Bundle {
  /** The video without the analysis: the original bytes when the analysis was the last box. */
  video: Blob;
  /** The saved analysis (pose-series JSON), or null when the file carries none. */
  series: string | null;
}

/** The analysis box of a file and its text, or null when the file carries none. */
async function findSeries(file: ByteSource): Promise<{ box: Box; series: string } | null> {
  const box = (await scanBoxes(file))?.filter((b) => b.ours).at(-1);
  if (!box) return null;
  try {
    // Its own 8-byte header (a 16-byte one is never written) and the user type, then the gzip.
    return { box, series: await gunzip(await file.read(box.start + HEADER, box.end)) };
  } catch {
    return null;
  }
}

/** Only the analysis a file carries, or null. It reads the box headers and the analysis box, never the video itself. */
export async function readSeries(file: ByteSource): Promise<string | null> {
  return (await findSeries(file))?.series ?? null;
}

/** Splits a file into its video and the analysis it carries. Any other file comes back whole, with no analysis. */
export async function readBundle(file: Blob): Promise<Bundle> {
  const found = await findSeries(blobSource(file));
  if (!found) return { video: file, series: null };
  const { box, series } = found;
  // Only a box at the very end is cut off: what comes after it belongs to the file.
  const video = box.end === file.size ? file.slice(0, box.start, file.type) : file;
  return { video, series };
}

/**
 * The video with `series` inside. A file that already carries an analysis gets the new one in place of the old one.
 * Throws a readable Error when the file is not an MP4 or QuickTime video that can take one more box.
 */
export async function writeBundle(video: Blob, series: string): Promise<Blob> {
  const plain = (await readBundle(video)).video;
  const boxes = await scanBoxes(blobSource(plain));
  // A last box "to the end of the file" would swallow the analysis.
  if (!boxes || boxes.at(-1)!.toEnd) throw new Error(t('err.bundleVideo'));
  const data = await gzip(series);
  const header = new Uint8Array(HEADER);
  new DataView(header.buffer).setUint32(0, HEADER + data.length);
  header.set([0x75, 0x75, 0x69, 0x64], 4); // "uuid"
  header.set(USER_TYPE, 8);
  return new Blob([plain, header, data], { type: plain.type || 'video/mp4' });
}
