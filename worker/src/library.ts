import { pickBest, readSeries, writeSeries, type Choice, type Reading } from '../../src/library/best';
import { tokenMatches } from './logic';
import { objectResponse } from './r2';

/**
 * The library: the videos of the Trampoline-AQA dataset (`scripts/library-upload.mjs` puts them in the shares bucket under
 * `library/<id>.mp4`, and lists them with their titles in `library/index.json`), and for each the best analysis anybody made of it. People open a
 * clip from the app's first screen, the app analyzes it when it has no analysis yet, and sends the result here without asking
 * (the person knows from the page they opened). Only the app's token is needed: the library holds nothing personal.
 *
 * An upload is judged here, not by the browser: the Worker reads the analysis again (src/library/best.ts), measures how much of the clip
 * it reads well, and keeps it only when that beats what is stored. When two analyses read different stretches of the clip well, it
 * stitches them into a third and keeps that one if it reads more than both. So an upload can only improve a clip, and a score cannot be
 * claimed. The owner removes an analysis with the REVIEW_TOKEN (`DELETE /library/<id>/analysis`).
 *
 * Each analysis is a gzipped series under its own versioned key (`library/<id>.<version>.series.gz`); D1 (`library_analysis`) holds the
 * current version, so two uploads at once cannot leave a score that belongs to another file.
 */

export const LIBRARY_PREFIX = 'library/';
export const videoKey = (id: string) => `${LIBRARY_PREFIX}${id}.mp4`;
export const seriesKey = (id: string, version: number) => `${LIBRARY_PREFIX}${id}.${version}.series.gz`;
/** The id of a library video: the app's `videoIdOf` (src/dataset/videoId.ts). */
export const isVideoId = (id: string) => /^v-[0-9a-f]{12}$/.test(id);

/** The most an analysis may weigh, gzipped and read. A one-minute clip is 1 to 5 MB of JSON, ten times less gzipped. */
export const MAX_SERIES_GZ = 15_000_000;
export const MAX_SERIES_TEXT = 120_000_000;
/** A saved analysis covers the whole clip: its last frame is within this of the video's length, as a share of it, or this many seconds. */
const LENGTH_SLACK_S = 2;
const LENGTH_SLACK = 0.1;

export interface LibraryEnv {
  DB: D1Database;
  SHARES: R2Bucket;
  SHARE_LIMIT?: RateLimit;
  REVIEW_TOKEN?: string;
}

type Reply = (body: unknown, status?: number) => Response;

export const INDEX_KEY = `${LIBRARY_PREFIX}index.json`;

/** One video of `library/index.json`, as the upload script wrote it (the rest of the dataset's labels come along). */
export interface VideoEntry {
  id: string;
  title: string;
  size: number;
  durationS?: number;
  [key: string]: unknown;
}

/** The videos the library lists. Empty before the first upload, or when the file cannot be read. */
export async function readIndex(env: Pick<LibraryEnv, 'SHARES'>): Promise<VideoEntry[]> {
  try {
    const object = await env.SHARES.get(INDEX_KEY);
    const body = object ? ((await object.json()) as { clips?: unknown }) : null;
    return Array.isArray(body?.clips)
      ? body.clips.filter(
          (c): c is VideoEntry =>
            !!c && typeof c.id === 'string' && isVideoId(c.id) && typeof c.title === 'string' && c.title !== '',
        )
      : [];
  } catch {
    return [];
  }
}

interface AnalysisRow {
  video_id: string;
  version: number;
  score: number;
  found: number;
  jumps: number;
  backend: string;
  merged: number;
  contributions: number;
  updated_at: string;
}

const summary = (row: AnalysisRow) => ({
  score: row.score,
  found: row.found,
  jumps: row.jumps,
  backend: row.backend,
  merged: row.merged > 0,
  contributions: row.contributions,
  updatedAt: row.updated_at,
});

/** The /library routes, or null for any other path. */
export async function handleLibrary(
  req: Request,
  env: LibraryEnv,
  path: string,
  canUpload: boolean,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response | null> {
  if (path === '/library' && req.method === 'GET') return list(env, reply);
  const m = /^\/library\/([^/]+)(\/analysis)?$/.exec(path);
  if (!m) return null;
  const [, id, analysis] = m;
  if (!isVideoId(id)) return reply({ error: 'not found' }, 404);
  if (!analysis) {
    return req.method === 'GET' || req.method === 'HEAD' ? serveVideo(req, env, id, cors, reply) : null;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveAnalysis(req, env, id, cors, reply);
  if (req.method === 'POST') return upload(req, env, id, canUpload, reply);
  if (req.method === 'DELETE') return removeAnalysis(req, env, id, reply);
  return reply({ error: 'not found' }, 404);
}

/** Every video of the library with the summary of its analysis (public, a minute of cache: it is the menu of the first screen). */
async function list(env: LibraryEnv, reply: Reply): Promise<Response> {
  const videos = await readIndex(env);
  const { results } = await env.DB.prepare(`SELECT * FROM library_analysis`).all<AnalysisRow>();
  const rows = new Map(results.map((r) => [r.video_id, r]));
  const response = reply({
    clips: videos.map((v) => ({
      id: v.id,
      title: v.title,
      size: v.size,
      durationS: v.durationS ?? null,
      analysis: rows.has(v.id) ? summary(rows.get(v.id)!) : null,
    })),
  });
  response.headers.set('cache-control', 'public, max-age=60');
  return response;
}

async function serveVideo(
  req: Request,
  env: LibraryEnv,
  id: string,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response> {
  const key = videoKey(id);
  const object =
    req.method === 'HEAD'
      ? await env.SHARES.head(key)
      : await env.SHARES.get(key, { range: req.headers, onlyIf: req.headers });
  if (!object) return reply({ error: 'not found' }, 404);
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('x-content-type-options', 'nosniff');
  return objectResponse(req, object, headers);
}

async function serveAnalysis(
  req: Request,
  env: LibraryEnv,
  id: string,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response> {
  const row = await env.DB.prepare(`SELECT version FROM library_analysis WHERE video_id = ?1`)
    .bind(id)
    .first<{ version: number }>();
  if (!row) return reply({ error: 'not found' }, 404);
  const key = seriesKey(id, row.version);
  const object = req.method === 'HEAD' ? await env.SHARES.head(key) : await env.SHARES.get(key);
  if (!object) return reply({ error: 'not found' }, 404);
  const headers = new Headers(cors);
  headers.set('content-type', 'application/gzip');
  // It changes whenever somebody improves it: always asked again, answered with a 304 while it is the same.
  headers.set('cache-control', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  return objectResponse(req, object, headers);
}

/** The text of a gzipped file, or null when it is not gzip or holds more than `max` characters. */
export async function gunzipLimited(data: ArrayBuffer, max: number): Promise<string | null> {
  try {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
      if (text.length > max) {
        await reader.cancel();
        return null;
      }
    }
  } catch {
    return null;
  }
}

const gzip = async (text: string): Promise<ArrayBuffer> =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

/** Why an analysis cannot be the one of this video, or null when it can. */
export function mismatch(reading: Reading, id: string, durationS: number | undefined): string | null {
  const { source } = reading.parsed;
  if (source.videoId !== id) return 'this analysis is not of this video';
  if (reading.parsed.tracks.length !== 1) return 'one athlete at a time';
  const last = reading.parsed.track.times.at(-1) ?? 0;
  if (durationS !== undefined && Number.isFinite(durationS)) {
    const slack = Math.max(LENGTH_SLACK_S, LENGTH_SLACK * durationS);
    if (last > durationS + LENGTH_SLACK_S || last < durationS - slack) return 'this analysis does not cover the video';
  }
  return null;
}

async function upload(req: Request, env: LibraryEnv, id: string, canUpload: boolean, reply: Reply): Promise<Response> {
  if (!canUpload) return reply({ error: 'unauthorized' }, 401);
  if (env.SHARE_LIMIT) {
    const { success } = await env.SHARE_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return reply({ error: 'too many uploads, try again in a minute' }, 429);
  }
  const length = Number(req.headers.get('content-length'));
  if (!Number.isInteger(length) || length <= 0) return reply({ error: 'content-length required' }, 411);
  if (length > MAX_SERIES_GZ) return reply({ error: `at most ${MAX_SERIES_GZ} bytes` }, 413);

  const video = (await readIndex(env)).find((v) => v.id === id);
  if (!video) return reply({ error: 'not found' }, 404);
  const text = await gunzipLimited(await req.arrayBuffer(), MAX_SERIES_TEXT);
  if (text === null) return reply({ error: 'expected a gzipped analysis' }, 415);
  let incoming: Reading;
  try {
    incoming = readSeries(text);
  } catch {
    return reply({ error: 'not a saved analysis' }, 400);
  }
  const wrong = mismatch(incoming, id, video.durationS);
  if (wrong) return reply({ error: wrong }, 422);

  // Optimistic: the judgement is made against the version it read, and the row only moves if nobody else moved it first.
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await env.DB.prepare(`SELECT * FROM library_analysis WHERE video_id = ?1`)
      .bind(id)
      .first<AnalysisRow>();
    let stored: Reading | null = null;
    if (row) {
      const object = await env.SHARES.get(seriesKey(id, row.version));
      const old = object && (await gunzipLimited(await object.arrayBuffer(), MAX_SERIES_TEXT));
      // A stored analysis that cannot be read any more (an old format) gives way to anything readable.
      try {
        stored = old ? readSeries(old) : null;
      } catch {
        stored = null;
      }
    }
    const pick = pickBest(stored, incoming);
    if (pick.choice === 'stored' && row) {
      return reply({ kept: 'stored' satisfies Choice, ...summary(row), incomingScore: incoming.completion.score });
    }

    const version = (row?.version ?? 0) + 1;
    const body = pick.choice === 'incoming' ? await gzip(text) : await gzip(writeSeries(pick.best));
    await env.SHARES.put(seriesKey(id, version), body, { httpMetadata: { contentType: 'application/gzip' } });
    const c = pick.best.completion;
    const now = new Date().toISOString();
    const backend = pick.best.parsed.source.backend.slice(0, 120);
    const done = row
      ? await env.DB.prepare(
          `UPDATE library_analysis SET version = ?2, score = ?3, found = ?4, jumps = ?5, backend = ?6, merged = merged + ?7,
             contributions = contributions + 1, updated_at = ?8 WHERE video_id = ?1 AND version = ?9`,
        )
          .bind(id, version, c.score, c.found, c.jumps, backend, pick.choice === 'merged' ? 1 : 0, now, row.version)
          .run()
      : await env.DB.prepare(
          `INSERT OR IGNORE INTO library_analysis (video_id, version, score, found, jumps, backend, merged, contributions, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7)`,
        )
          .bind(id, version, c.score, c.found, c.jumps, backend, now)
          .run();
    if (!done.meta.changes) {
      // Somebody else moved first: this version is nobody's, and the judgement starts again on theirs.
      await env.SHARES.delete(seriesKey(id, version));
      continue;
    }
    if (row) await env.SHARES.delete(seriesKey(id, row.version));
    return reply(
      {
        kept: pick.choice,
        score: c.score,
        found: c.found,
        jumps: c.jumps,
        previousScore: stored?.completion.score ?? null,
        incomingScore: incoming.completion.score,
      },
      201,
    );
  }
  return reply({ error: 'busy, try again' }, 503);
}

async function removeAnalysis(req: Request, env: LibraryEnv, id: string, reply: Reply): Promise<Response> {
  if (!tokenMatches(req.headers.get('authorization'), env.REVIEW_TOKEN)) return reply({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare(`SELECT version FROM library_analysis WHERE video_id = ?1`)
    .bind(id)
    .first<{ version: number }>();
  if (!row) return reply({ error: 'not found' }, 404);
  await env.DB.prepare(`DELETE FROM library_analysis WHERE video_id = ?1`).bind(id).run();
  await env.SHARES.delete(seriesKey(id, row.version));
  return reply({ deleted: true });
}
