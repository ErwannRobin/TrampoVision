import { t } from '../i18n/core';
import { gunzip, gzip } from '../video/bundle';
import { fetchWithProgress } from '../video/sample';
import { SHARE_API_URL, shareErrorText } from './share';

/**
 * The library: the videos of the Trampoline-AQA dataset, kept in the review Worker's bucket (worker/src/library.ts), each with the best
 * analysis anybody made of it. A clip opens from the first screen; one that has no analysis yet is analyzed here like any video, and
 * the result goes back to the library by itself, where the Worker keeps it only if it reads more of the clip than what is stored, or
 * stitches it with the stored one when each reads a different stretch well. Without a review service there is no library.
 */

const TOKEN = (import.meta.env.VITE_REVIEW_INGEST_TOKEN as string | undefined) || '';
const ID = /^v-[0-9a-f]{12}$/;

/** How much of a clip its best analysis read, as the Worker measured it. */
export interface LibraryAnalysis {
  /** Share of the clip read as bounces, 0..1. */
  score: number;
  found: number;
  jumps: number;
  backend: string;
  /** Stitched from several analyses. */
  merged: boolean;
  /** How many analyses were sent for this clip. */
  contributions: number;
  updatedAt: string;
}

export interface LibraryClip {
  id: string;
  title: string;
  size: number;
  durationS: number | null;
  analysis: LibraryAnalysis | null;
}

/** What the Worker did with an analysis: kept the new one, stitched the two, or kept what it had (the new one read less). */
export type LibraryOutcome =
  | { kept: 'incoming' | 'merged'; score: number; previousScore: number | null }
  | { kept: 'stored'; score: number; incomingScore: number };

function clipOf(raw: unknown): LibraryClip[] {
  const c = raw as Partial<LibraryClip> | null;
  if (!c || typeof c.id !== 'string' || !ID.test(c.id) || typeof c.title !== 'string' || !c.title) return [];
  const a = c.analysis as Partial<LibraryAnalysis> | null | undefined;
  const analysis =
    a && typeof a.score === 'number' && Number.isFinite(a.score)
      ? {
          score: a.score,
          found: Number(a.found) || 0,
          jumps: Number(a.jumps) || 0,
          backend: String(a.backend ?? ''),
          merged: !!a.merged,
          contributions: Number(a.contributions) || 1,
          updatedAt: String(a.updatedAt ?? ''),
        }
      : null;
  return [
    {
      id: c.id,
      title: c.title,
      size: Number(c.size) || 0,
      durationS: typeof c.durationS === 'number' ? c.durationS : null,
      analysis,
    },
  ];
}

/**
 * The clips to offer first: the ones nobody analyzed, then the least read, so that what people analyze is what the library lacks most.
 * Within a score the order of the dataset (by title) is kept.
 */
export function inNeedOrder(clips: LibraryClip[]): LibraryClip[] {
  return [...clips].sort((a, b) => (a.analysis?.score ?? -1) - (b.analysis?.score ?? -1));
}

/** The library, or an empty list without a review service or when it cannot be reached or read. */
export async function fetchLibrary(fresh = false): Promise<LibraryClip[]> {
  if (!SHARE_API_URL) return [];
  try {
    const response = await fetch(`${SHARE_API_URL}/library`, fresh ? { cache: 'no-cache' } : undefined);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const list = body && typeof body === 'object' ? (body as { clips?: unknown }).clips : null;
    return Array.isArray(list) ? list.flatMap(clipOf) : [];
  } catch {
    return [];
  }
}

/** The video of a clip as a file, and its best analysis (the saved-analysis JSON) when it has one. Throws a readable Error. */
export async function downloadLibraryClip(
  clip: LibraryClip,
  onProgress?: (fraction: number) => void,
): Promise<{ file: File; series: string | null }> {
  if (!SHARE_API_URL) throw new Error(t('share.unavailable'));
  let video;
  try {
    video = await fetchWithProgress(`${SHARE_API_URL}/library/${clip.id}`, onProgress);
  } catch {
    throw new Error(shareErrorText(0));
  }
  if (!video.ok) throw new Error(video.status === 404 ? t('library.errGone') : shareErrorText(video.status));
  const name = `${clip.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ')}.mp4`;
  const file = new File([video.blob], name, { type: 'video/mp4' });
  let series: string | null = null;
  if (clip.analysis) {
    try {
      const response = await fetch(`${SHARE_API_URL}/library/${clip.id}/analysis`);
      // The analysis is an extra: without it the clip is analyzed here, which the person can wait for.
      if (response.ok) series = await gunzip(await response.blob());
    } catch {
      series = null;
    }
  }
  return { file, series };
}

/** Sends the analysis of a clip. The Worker answers with what it did; it rejects an analysis that is not of this clip. */
export async function sendLibraryAnalysis(id: string, series: string): Promise<LibraryOutcome> {
  if (!SHARE_API_URL) throw new Error(t('share.unavailable'));
  let response: Response;
  try {
    response = await fetch(`${SHARE_API_URL}/library/${id}/analysis`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/gzip' },
      body: await gzip(series),
    });
  } catch {
    throw new Error(shareErrorText(0));
  }
  if (!response.ok) throw new Error(shareErrorText(response.status));
  const body = (await response.json()) as Record<string, unknown>;
  const kept = body.kept === 'incoming' || body.kept === 'merged' || body.kept === 'stored' ? body.kept : null;
  if (!kept || typeof body.score !== 'number') throw new Error(shareErrorText(response.status));
  return kept === 'stored'
    ? { kept, score: body.score, incomingScore: Number(body.incomingScore) || 0 }
    : {
        kept,
        score: body.score,
        previousScore: typeof body.previousScore === 'number' ? body.previousScore : null,
      };
}

/** A score as the menu shows it: "81%". */
export const percent = (score: number) => `${Math.round(score * 100)}%`;
