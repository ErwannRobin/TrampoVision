/** Picks the video to analyse among dropped files: by MIME type, else by extension (.mov is often untyped). */
export function pickDroppedVideo(files: ArrayLike<File> | null | undefined): File | null {
  return Array.from(files ?? []).find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f.name)) ?? null;
}

/** Picks the saved analysis (a pose-series JSON) among dropped files. */
export function pickDroppedSeries(files: ArrayLike<File> | null | undefined): File | null {
  return Array.from(files ?? []).find((f) => f.type === 'application/json' || /\.json$/i.test(f.name)) ?? null;
}

/** True when a drag carries files (as opposed to selected text or a link). */
export const dragHasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
