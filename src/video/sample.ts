import { t } from '../i18n/core';
/**
 * The sample videos are not part of the build (they would be copied into every deployment). They live at
 * VITE_SAMPLE_BASE_URL (for example a public Vercel Blob store), and only one is fetched, when requested.
 * Without that variable there is no sample and the button is hidden. The browser gets the file it decodes natively:
 * the iPhone .mov in Safari, the H.264 .mp4 elsewhere (desktop Chrome cannot decode the HEVC .mov without a slow
 * in-browser conversion).
 */
const SAMPLE_FILES = ['IMG_8368.mp4', 'IMG_8368.MOV'];

const sampleBase = (() => {
  const url = (import.meta.env.VITE_SAMPLE_BASE_URL as string | undefined)?.trim();
  return url ? `${url.replace(/\/+$/, '')}/` : null;
})();

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

export const samplePath = sampleBase ? pickSample(SAMPLE_FILES.map((file) => sampleBase + file)) : null;

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
