/** What the moderation page shows of a clip. The Worker (worker/src/shares.ts, `GET /admin/shares`) says it. */
export interface Clip {
  id: string;
  size: number;
  contentType: string;
  createdAt: string;
  /** When the Worker deletes it; null for a clip listed among the examples, which stays. */
  expiresAt: string | null;
  listed: boolean;
  /** The title in the menu, when listed. */
  label: string | null;
  listedAt: string | null;
}

export interface Totals {
  clips: number;
  bytes: number;
  listed: number;
}

export type Filter = 'all' | 'listed' | 'unlisted';

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'listed', label: 'Listed' },
  { id: 'unlisted', label: 'Not listed' },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(Math.round(bytes / 1e3), bytes > 0 ? 1 : 0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

const DAY = 86_400_000;

/** How long a clip stays, in a few words: "kept for good", "3 days left", "expires today". */
export function stayText(clip: Pick<Clip, 'expiresAt'>, now = Date.now()): string {
  if (clip.expiresAt === null) return 'kept for good';
  const left = Math.ceil((Date.parse(clip.expiresAt) - now) / DAY);
  if (!Number.isFinite(left)) return '';
  if (left <= 0) return 'expires today';
  return left === 1 ? '1 day left' : `${left} days left`;
}

/** A date for a table: "2026-10-16". */
export const shortDate = (iso: string | null): string =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';

/** Keeps only well-formed rows of an answer, so a changed Worker cannot break the page. */
export function readClips(body: unknown): { clips: Clip[]; totals: Totals; maxExamples: number } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const clips = (Array.isArray(b.clips) ? b.clips : []).flatMap((raw): Clip[] => {
    const c = raw as Partial<Clip> | null;
    if (!c || typeof c.id !== 'string' || typeof c.size !== 'number' || typeof c.createdAt !== 'string') return [];
    return [
      {
        id: c.id,
        size: c.size,
        contentType: typeof c.contentType === 'string' ? c.contentType : 'video/mp4',
        createdAt: c.createdAt,
        expiresAt: typeof c.expiresAt === 'string' ? c.expiresAt : null,
        listed: c.listed === true,
        label: typeof c.label === 'string' ? c.label : null,
        listedAt: typeof c.listedAt === 'string' ? c.listedAt : null,
      },
    ];
  });
  const t = (b.totals && typeof b.totals === 'object' ? b.totals : {}) as Partial<Totals>;
  return {
    clips,
    totals: { clips: Number(t.clips) || 0, bytes: Number(t.bytes) || 0, listed: Number(t.listed) || 0 },
    maxExamples: Number(b.maxExamples) || 0,
  };
}
