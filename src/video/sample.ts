/**
 * Bundled sample videos (video-sample/). Vite emits them as same-origin assets and only fetches one when
 * requested. The browser gets the file it decodes natively: the iPhone .mov in Safari, the H.264 .mp4 elsewhere
 * (desktop Chrome cannot decode the HEVC .mov without a slow in-browser conversion).
 */
const samples = import.meta.glob<string>('../../video-sample/*.{mp4,MOV,mov}', {
  query: '?url',
  import: 'default',
});

/** Safari (macOS/iOS) decodes HEVC .mov natively. Chromium browsers and Firefox do not reliably. */
export function decodesHevcMov(userAgent: string = navigator.userAgent): boolean {
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(userAgent);
}

const extensionOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Path of the sample suited to this browser, or null when no sample is bundled. */
export function pickSample(paths: string[], userAgent?: string): string | null {
  const preferred = decodesHevcMov(userAgent) ? 'mov' : 'mp4';
  const sorted = [...paths].sort();
  return sorted.find((p) => extensionOf(p) === preferred) ?? sorted.find((p) => extensionOf(p) === 'mp4') ?? null;
}

export const samplePath = pickSample(Object.keys(samples));

/** Downloads the sample into a File, so it goes through the same path as a user-selected file. */
export async function loadSample(path: string): Promise<File> {
  const url = await samples[path]();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the sample video (HTTP ${response.status}).`);
  const blob = await response.blob();
  const name = path.slice(path.lastIndexOf('/') + 1);
  return new File([blob], name, { type: extensionOf(path) === 'mov' ? 'video/quicktime' : 'video/mp4' });
}
