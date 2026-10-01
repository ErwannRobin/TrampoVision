import { assetBase } from '../assets';
import { t } from '../i18n/core';

/**
 * The sample videos are not part of the build (they would be copied into every deployment). They are read from the
 * asset host (samples/, see src/assets.ts), and only one is fetched, when requested. The list is not hard-coded:
 * `npm run upload-assets` writes samples/index.json (the file names in the store), read once at startup. Files that
 * share a name and differ by extension are one clip (IMG_8368.mp4 and IMG_8368.MOV), and the browser gets the one it
 * decodes natively: the iPhone .mov in Safari, the H.264 .mp4 elsewhere (desktop Chrome cannot decode the HEVC .mov
 * without a slow in-browser conversion). Without an asset host, or without that index, there is no sample and the
 * button is hidden.
 */
export interface Sample {
  id: string;
  /** The file name without its extension, spaces for underscores and dashes: "dong-dong_2011" reads "dong dong 2011". */
  label: string;
  path: string;
}

/**
 * Desktop Safari decodes the HEVC .mov natively. Chromium browsers and Firefox do not reliably, and on iPhone/iPad
 * the 1080p HEVC clip fails the decode probe and ends up converted, so they all get the H.264 .mp4.
 * iPadOS reports a Mac user agent, hence the touch check (Macs have no multi-touch screen).
 */
export function decodesHevcMov(
  userAgent: string = navigator.userAgent,
  maxTouchPoints: number = navigator.maxTouchPoints,
): boolean {
  const mobile = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(userAgent) && !mobile;
}

const extensionOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Path of the sample suited to this browser, or null when no sample is bundled. */
export function pickSample(paths: string[], userAgent?: string, maxTouchPoints?: number): string | null {
  const preferred = decodesHevcMov(userAgent, maxTouchPoints) ? 'mov' : 'mp4';
  const sorted = [...paths].sort();
  return sorted.find((p) => extensionOf(p) === preferred) ?? sorted.find((p) => extensionOf(p) === 'mp4') ?? null;
}

const VIDEO_FILE = /\.(mp4|mov)$/i;

/** Groups the file names by clip (same name, different extension) and picks, for each, the file suited to this browser. */
export function samplesFromFiles(base: string, files: string[], userAgent?: string, maxTouchPoints?: number): Sample[] {
  const clips = new Map<string, string[]>();
  for (const file of files.filter((f) => VIDEO_FILE.test(f))) {
    const id = file.slice(0, file.lastIndexOf('.'));
    clips.set(id, [...(clips.get(id) ?? []), file]);
  }
  return [...clips]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, names]) => {
      const path = pickSample(
        names.map((name) => `${base}samples/${encodeURIComponent(name)}`),
        userAgent,
        maxTouchPoints,
      );
      return path ? [{ id, label: id.replace(/[_-]+/g, ' ').trim(), path }] : [];
    });
}

/** The sample clips on the asset host. Empty without an asset host, or when its index is missing or unreadable. */
export async function loadSamples(): Promise<Sample[]> {
  if (!assetBase) return [];
  try {
    const response = await fetch(`${assetBase}samples/index.json`);
    if (!response.ok) return [];
    const index: unknown = await response.json();
    const files = index && typeof index === 'object' ? (index as { files?: unknown }).files : null;
    return Array.isArray(files)
      ? samplesFromFiles(
          assetBase,
          files.filter((f): f is string => typeof f === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

/** Downloads the sample into a File, so it goes through the same path as a user-selected file. */
export async function loadSample(path: string, onProgress?: (fraction: number) => void): Promise<File> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(t('err.sampleHttp', { status: response.status }));
  const size = Number(response.headers.get('content-length'));
  let blob: Blob;
  if (response.body && size > 0 && onProgress) {
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      onProgress(Math.min(received / size, 1));
    }
    blob = new Blob(chunks);
  } else {
    blob = await response.blob();
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  return new File([blob], name, { type: extensionOf(path) === 'mov' ? 'video/quicktime' : 'video/mp4' });
}
