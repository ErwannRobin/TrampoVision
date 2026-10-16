import { tokenMatches, type Parsed } from './logic';
import { objectResponse } from './r2';

/**
 * Shared clips. A person who chooses "Share link" uploads the clip with its analysis inside (one MP4, see src/video/bundle.ts), and
 * anyone with the link opens it already analyzed. The files are in R2 (EU jurisdiction), one row each in D1 (`shares`), and both go
 * after SHARE_DAYS (the bucket's lifecycle rule removes the file, see `make worker-r2`). The link is the only key to read a clip: its id
 * is 128 random bits. Removing one takes the key that only the person who uploaded it received.
 *
 * The uploader can also list the clip among the examples of the app's first screen. A listed clip is the one exception to SHARE_DAYS: it
 * is moved to `examples/<id>` (the bucket's expiry rule only covers `shares/`), its row never expires, and `GET /examples` names it to
 * everyone. It stays until the uploader stops sharing it, or the owner (REVIEW_TOKEN) removes it.
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
export const exampleKey = (id: string) => `examples/${id}`;

/** The expiry of a listed clip: a date no clock reaches, so every `expires_at <= now` test still works. */
export const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';
/** The most clips listed at once, and the longest name of one: the list is public, it must stay a short, readable menu. */
export const MAX_EXAMPLES = 40;
export const MAX_LABEL = 60;

/**
 * The name a person gave a listed clip, tidied: one line, no control or text-direction characters (the name is shown to everyone, and
 * a right-to-left override could make it read as something else), at most MAX_LABEL; null when nothing is left.
 */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const label = raw
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label ? [...label].slice(0, MAX_LABEL).join('').trim() : null;
}

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

export interface ShareEnv {
  DB: D1Database;
  SHARES: R2Bucket;
  /** Uploads per person (per address) and per minute: see wrangler.toml. */
  SHARE_LIMIT?: RateLimit;
  /** The owner's key: it may remove any shared clip, a listed one above all. */
  REVIEW_TOKEN?: string;
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
  if (path === '/examples' && req.method === 'GET') return examples(env, reply);
  const one = /^\/shares\/([^/]+)$/.exec(path);
  const list = /^\/shares\/([^/]+)\/example$/.exec(path);
  if (!one && !list) return null;
  const id = (one ?? list)![1];
  if (!isShareId(id)) return reply({ error: 'not found' }, 404);
  if (list) return req.method === 'PUT' ? listExample(req, env, id, reply) : reply({ error: 'not found' }, 404);
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
  const row = await env.DB.prepare(
    `SELECT s.expires_at, e.id AS example FROM shares s LEFT JOIN examples e ON e.id = s.id WHERE s.id = ?1`,
  )
    .bind(id)
    .first<{ expires_at: string; example: string | null }>();
  if (!row || row.expires_at <= new Date().toISOString()) return reply({ error: 'not found' }, 404);
  const key = row.example ? exampleKey(id) : shareKey(id);
  const object =
    req.method === 'HEAD'
      ? await env.SHARES.head(key)
      : await env.SHARES.get(key, { range: req.headers, onlyIf: req.headers });
  if (!object) return reply({ error: 'not found' }, 404);

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('cache-control', row.example ? 'public, max-age=3600' : 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'content-disposition',
    `inline; filename="trampovision-${id}.${object.httpMetadata?.contentType === 'video/quicktime' ? 'mov' : 'mp4'}"`,
  );
  return objectResponse(req, object, headers);
}

async function remove(req: Request, env: ShareEnv, id: string, reply: Reply): Promise<Response> {
  const header = req.headers.get('authorization');
  const key = /^Bearer (.+)$/.exec(header ?? '')?.[1];
  const row = await env.DB.prepare(`SELECT delete_hash FROM shares WHERE id = ?1`)
    .bind(id)
    .first<{ delete_hash: string }>();
  if (!row) return reply({ error: 'not found' }, 404);
  const owner = tokenMatches(header, env.REVIEW_TOKEN);
  if (!owner && (!key || (await sha256Hex(key)) !== row.delete_hash)) return reply({ error: 'unauthorized' }, 401);
  // Either place: a clip is in one of them, and deleting what is not there does nothing.
  await env.SHARES.delete([shareKey(id), exampleKey(id)]);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM examples WHERE id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM shares WHERE id = ?1`).bind(id),
  ]);
  return reply({ deleted: true });
}

/** The listed clips, newest first: public, like the first screen they appear on. */
async function examples(env: ShareEnv, reply: Reply): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT id, label FROM examples ORDER BY listed_at DESC LIMIT ?1`)
    .bind(MAX_EXAMPLES)
    .all<{ id: string; label: string }>();
  return reply({ examples: results });
}

/**
 * Lists a shared clip among the examples, for good. Takes the key the uploader received and a name. The file is copied to
 * `examples/<id>` before anything else changes, so a failure half way leaves the clip shared as it was.
 */
async function listExample(req: Request, env: ShareEnv, id: string, reply: Reply): Promise<Response> {
  const key = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  const label = cleanLabel(((await req.json().catch(() => null)) as { label?: unknown } | null)?.label);
  if (!label) return reply({ error: `a name of 1 to ${MAX_LABEL} characters is required` }, 400);
  const row = await env.DB.prepare(
    `SELECT s.delete_hash, s.expires_at, s.content_type, e.id AS example FROM shares s LEFT JOIN examples e ON e.id = s.id WHERE s.id = ?1`,
  )
    .bind(id)
    .first<{ delete_hash: string; expires_at: string; content_type: string; example: string | null }>();
  if (!row || row.expires_at <= new Date().toISOString()) return reply({ error: 'not found' }, 404);
  if (!key || (await sha256Hex(key)) !== row.delete_hash) return reply({ error: 'unauthorized' }, 401);
  if (row.example) {
    // Listed already: only the name changes.
    await env.DB.prepare(`UPDATE examples SET label = ?2 WHERE id = ?1`).bind(id, label).run();
    return reply({ id, label });
  }
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM examples`).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_EXAMPLES) return reply({ error: 'the examples are full for now' }, 503);

  const source = await env.SHARES.get(shareKey(id));
  if (!source) return reply({ error: 'not found' }, 404);
  const copy = await env.SHARES.put(exampleKey(id), source.body, { httpMetadata: { contentType: row.content_type } });
  if (!copy) return reply({ error: 'could not copy the clip' }, 500);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO examples (id, label, listed_at) VALUES (?1, ?2, ?3)`).bind(
        id,
        label,
        new Date().toISOString(),
      ),
      env.DB.prepare(`UPDATE shares SET expires_at = ?2 WHERE id = ?1`).bind(id, NEVER_EXPIRES),
    ]);
  } catch (e) {
    await env.SHARES.delete(exampleKey(id));
    throw e;
  }
  await env.SHARES.delete(shareKey(id));
  return reply({ id, label }, 201);
}
