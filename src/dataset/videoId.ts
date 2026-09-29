import type { PoseTrack } from '../analysis/types';

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** FNV-1a, 32 bit: a fallback where SubtleCrypto is missing (an insecure page). */
function fnv(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SAMPLE = 256 * 1024;

/**
 * A stable id for a video file, computed in the browser from the file itself: a SHA-256 of its size and of the first and last
 * 256 KiB (enough to tell two recordings apart without reading a whole 2 GB file). The same file gets the same id after a
 * reload, so labels stay attached to it. The file name is not part of it: renaming a file does not lose its labels.
 */
export async function videoIdOf(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, SAMPLE).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - SAMPLE)).arrayBuffer());
  const size = new TextEncoder().encode(`size:${file.size}:`);
  const all = new Uint8Array(size.length + head.length + tail.length);
  all.set(size, 0);
  all.set(head, size.length);
  all.set(tail, size.length + head.length);
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) return `v-${hex(await subtle.digest('SHA-256', all)).slice(0, 12)}`;
  return `v-${fnv(all).toString(16).padStart(8, '0')}${fnv(all, 0x9747b28c).toString(16).padStart(8, '0')}`.slice(
    0,
    14,
  );
}

/**
 * An id for data that was opened without its video (a saved series): from what it contains. Two series of the same clip
 * give the same id; it differs from `videoIdOf` of the video, which is why a series file carries the video's own id when it has one.
 */
export function videoIdFromTrack(fileName: string, track: PoseTrack): string {
  const first = track.frames.findIndex((f) => f !== null);
  const kp = first >= 0 ? track.frames[first]![0] : null;
  const text = `${fileName}|${track.width}x${track.height}|${track.sourceFps}|${track.frames.length}|${first}|${kp ? `${kp.x.toFixed(1)},${kp.y.toFixed(1)}` : ''}`;
  const bytes = new TextEncoder().encode(text);
  return `s-${fnv(bytes).toString(16).padStart(8, '0')}${fnv(bytes, 0x9747b28c).toString(16).padStart(8, '0')}`.slice(
    0,
    14,
  );
}
