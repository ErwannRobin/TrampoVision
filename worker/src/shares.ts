import type { Parsed } from './logic';

/**
 * Shared clips. A person who chooses "Share link" uploads the clip with its analysis inside (one MP4, see src/video/bundle.ts), and
 * anyone with the link opens it already analyzed. The files are in R2 (EU jurisdiction), one row each in D1 (`shares`), and both go
 * after SHARE_DAYS (the bucket's lifecycle rule removes the file, see `make worker-r2`). The link is the only key to read a clip: its id
 * is 128 random bits. Removing one takes the key that only the person who uploaded it received.
 */

export const SHARE_DAYS = 90;
/** The most a Worker on the free plan may receive in one request. */
export const MAX_SHARE_BYTES = 100_000_000;
/** Everyone together, per 24 hours, then over the lifetime of the clips: the upload is public, it must not fill the bucket. */
export const DAILY_SHARE_BYTES = 5_000_000_000;
export const MAX_LIVE_SHARE_BYTES = 50_000_000_000;
export const SHARE_TYPES = ['video/mp4', 'video/quicktime'] as const;

const ID = /^[A-Za-z0-9_-]{22}$/;
export const isShareId = (id: string) => ID.test(id);
export const shareKey = (id: string) => `shares/${id}`;

/** `bytes` random bytes in base64url: 16 make a share id of 22 characters. */
export function randomToken(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadCheck {
  type: (typeof SHARE_TYPES)[number];
  size: number;
}

/** Bytes of the clips shared in the last 24 hours, and of all the clips not expired yet. */
export interface ShareUsage {
  lastDay: number;
  live: number;
}

/** What an upload must say about itself before anything is stored, with the HTTP status of a refusal. */
export function checkUpload(
  contentType: string | null,
  contentLength: string | null,
  usage: ShareUsage,
): Parsed<UploadCheck> & { status?: number } {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!(SHARE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, status: 415, error: `expected ${SHARE_TYPES.join(' or ')}` };
  }
  const size = Number(contentLength);
  if (!contentLength || !Number.isInteger(size) || size <= 0) {
    return { ok: false, status: 411, error: 'content-length required' };
  }
  if (size > MAX_SHARE_BYTES) return { ok: false, status: 413, error: `at most ${MAX_SHARE_BYTES} bytes` };
  if (usage.lastDay + size > DAILY_SHARE_BYTES || usage.live + size > MAX_LIVE_SHARE_BYTES) {
    return { ok: false, status: 503, error: 'sharing is full for now' };
  }
  return { ok: true, value: { type: type as UploadCheck['type'], size } };
}

/** The box types an MP4 or QuickTime file can start with. */
const FIRST_BOXES = new Set(['ftyp', 'wide', 'free', 'skip', 'mdat', 'moov', 'pnot']);

/** Whether the first bytes of a file are the first box of an MP4 or QuickTime video. */
export function looksLikeVideo(head: Uint8Array): boolean {
  if (head.length < 8) return false;
  return FIRST_BOXES.has(String.fromCharCode(...head.subarray(4, 8)));
}

/** The part of a file of `size` bytes that R2 served, as a Content-Range value. */
export function contentRange(range: R2Range, size: number): string {
  const { offset, length, suffix } = range as { offset?: number; length?: number; suffix?: number };
  const start = suffix !== undefined ? Math.max(size - suffix, 0) : (offset ?? 0);
  const end = suffix !== undefined ? size - 1 : length !== undefined ? Math.min(start + length, size) - 1 : size - 1;
  return `bytes ${start}-${end}/${size}`;
}

export interface ShareEnv {
  DB: D1Database;
  SHARES: R2Bucket;
  /** Uploads per person (per address) and per minute: see wrangler.toml. */
  SHARE_LIMIT?: RateLimit;
}

type Reply = (body: unknown, status?: number) => Response;

/**
 * The /shares routes, or null for any other path. `canUpload`: the request carries the app's token. `cors`: the headers for the
 * calling origin.
 */
export async function handleShares(
  req: Request,
  env: ShareEnv,
  path: string,
  canUpload: boolean,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response | null> {
  if (path === '/shares' && req.method === 'POST') return upload(req, env, canUpload, reply);
  const one = /^\/shares\/([^/]+)$/.exec(path);
  if (!one) return null;
  const id = one[1];
  if (!isShareId(id)) return reply({ error: 'not found' }, 404);
  if (req.method === 'GET' || req.method === 'HEAD') return serve(req, env, id, cors, reply);
  if (req.method === 'DELETE') return remove(req, env, id, reply);
  return reply({ error: 'not found' }, 404);
}

async function upload(req: Request, env: ShareEnv, canUpload: boolean, reply: Reply): Promise<Response> {
  if (!canUpload) return reply({ error: 'unauthorized' }, 401);
  if (env.SHARE_LIMIT) {
    const { success } = await env.SHARE_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return reply({ error: 'too many shares, try again in a minute' }, 429);
  }
  const now = new Date();
  // The expired rows go first: their files are removed by the bucket's lifecycle rule.
  await env.DB.prepare(`DELETE FROM shares WHERE expires_at <= ?1`).bind(now.toISOString()).run();
  const usage = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN created_at > ?1 THEN size END), 0) AS lastDay, COALESCE(SUM(size), 0) AS live FROM shares`,
  )
    .bind(new Date(now.getTime() - 86_400_000).toISOString())
    .first<ShareUsage>();
  const check = checkUpload(
    req.headers.get('content-type'),
    req.headers.get('content-length'),
    usage ?? { lastDay: 0, live: 0 },
  );
  if (!check.ok) return reply({ error: check.error }, check.status ?? 400);
  if (!req.body) return reply({ error: 'empty body' }, 400);

  const id = randomToken(16);
  const deleteKey = randomToken(24);
  const expiresAt = new Date(now.getTime() + SHARE_DAYS * 86_400_000).toISOString();
  const stored = await env.SHARES.put(shareKey(id), req.body, {
    httpMetadata: { contentType: check.value.type },
  });
  // Only videos: anything else is removed at once.
  const head = await env.SHARES.get(shareKey(id), { range: { offset: 0, length: 8 } });
  if (!stored || !head || !looksLikeVideo(new Uint8Array(await head.arrayBuffer()))) {
    await env.SHARES.delete(shareKey(id));
    return reply({ error: 'not an MP4 or QuickTime video' }, 415);
  }
  await env.DB.prepare(
    `INSERT INTO shares (id, size, content_type, created_at, expires_at, delete_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, stored.size, check.value.type, now.toISOString(), expiresAt, await sha256Hex(deleteKey))
    .run();
  return reply({ id, expiresAt, deleteKey }, 201);
}

async function serve(
  req: Request,
  env: ShareEnv,
  id: string,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response> {
  const row = await env.DB.prepare(`SELECT expires_at FROM shares WHERE id = ?1`)
    .bind(id)
    .first<{ expires_at: string }>();
  if (!row || row.expires_at <= new Date().toISOString()) return reply({ error: 'not found' }, 404);
  const object =
    req.method === 'HEAD'
      ? await env.SHARES.head(shareKey(id))
      : await env.SHARES.get(shareKey(id), { range: req.headers, onlyIf: req.headers });
  if (!object) return reply({ error: 'not found' }, 404);

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'content-disposition',
    `inline; filename="trampovision-${id}.${object.httpMetadata?.contentType === 'video/quicktime' ? 'mov' : 'mp4'}"`,
  );
  const body = 'body' in object ? (object as R2ObjectBody).body : null;
  if (!body) {
    // HEAD, or a precondition (If-None-Match ...) that says the copy the browser has is the current one.
    if (req.method === 'HEAD') {
      headers.set('content-length', String(object.size));
      return new Response(null, { headers });
    }
    return new Response(null, { status: 304, headers });
  }
  if (req.headers.has('range') && object.range) {
    headers.set('content-range', contentRange(object.range, object.size));
    return new Response(body, { status: 206, headers });
  }
  headers.set('content-length', String(object.size));
  return new Response(body, { headers });
}

async function remove(req: Request, env: ShareEnv, id: string, reply: Reply): Promise<Response> {
  const key = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  const row = await env.DB.prepare(`SELECT delete_hash FROM shares WHERE id = ?1`)
    .bind(id)
    .first<{ delete_hash: string }>();
  if (!row) return reply({ error: 'not found' }, 404);
  if (!key || (await sha256Hex(key)) !== row.delete_hash) return reply({ error: 'unauthorized' }, 401);
  await env.SHARES.delete(shareKey(id));
  await env.DB.prepare(`DELETE FROM shares WHERE id = ?1`).bind(id).run();
  return reply({ deleted: true });
}
