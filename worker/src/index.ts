import { parseIngest, parseReview, tokenMatches, STATUSES, type JumpRow } from './logic';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  INGEST_TOKEN?: string;
  REVIEW_TOKEN?: string;
}

/**
 * The review backend. It never classifies: the browser does, and posts each jump with its measurements and its prediction as soon as
 * the analysis is done. A reviewer then confirms or corrects the answer; the confirmed and corrected jumps come back to the app as
 * labelled reference examples.
 */

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const cors = (env: Env, req: Request): Record<string, string> => {
  const origin = req.headers.get('origin');
  // The app's origin, and localhost for development.
  const ok = origin && (origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
  return ok
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        vary: 'origin',
      }
    : {};
};

const canWrite = (req: Request, env: Env) => {
  const h = req.headers.get('authorization');
  return tokenMatches(h, env.INGEST_TOKEN) || tokenMatches(h, env.REVIEW_TOKEN);
};
const canReview = (req: Request, env: Env) => tokenMatches(req.headers.get('authorization'), env.REVIEW_TOKEN);

const UPSERT = `INSERT INTO jumps (id, video_id, jump_id, auto_skill, auto_element_id, auto_certainty, auto_confidence, classifier, fingerprint, created_at, updated_at, record)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)
ON CONFLICT(id) DO UPDATE SET auto_skill = ?4, auto_element_id = ?5, auto_certainty = ?6, auto_confidence = ?7, classifier = ?8,
  fingerprint = ?9, updated_at = ?10, record = ?11`;

const upsert = (env: Env, r: JumpRow, now: string) =>
  env.DB.prepare(UPSERT).bind(
    r.id,
    r.video_id,
    r.jump_id,
    r.auto_skill,
    r.auto_element_id,
    r.auto_certainty,
    r.auto_confidence,
    r.classifier,
    r.fingerprint,
    now,
    r.record,
  );

const SUMMARY = `id, video_id, jump_id, auto_skill, auto_element_id, auto_certainty, auto_confidence, classifier, status,
  review_element_id, review_note, reviewer, reviewed_at, updated_at`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const reply = (body: unknown, status = 200) => json(body, status, h);

    try {
      if (path === '/' && req.method === 'GET') return reply({ service: 'trampovision-review', ok: true });

      // The browser posts every jump right after the analysis. A re-post of the same jump replaces the automatic answer and keeps the review.
      if (path === '/jumps' && req.method === 'POST') {
        if (!canWrite(req, env)) return reply({ error: 'unauthorized' }, 401);
        const body: unknown = await req.json().catch(() => null);
        const parsed = parseIngest(body);
        if (!parsed.ok) return reply({ error: parsed.error }, 400);
        const now = new Date().toISOString();
        await env.DB.batch(parsed.value.map((r) => upsert(env, r, now)));
        return reply({ stored: parsed.value.length });
      }

      // The confirmed and corrected jumps, as records with their figure, for the app's reference library.
      if (path === '/references' && req.method === 'GET') {
        if (!canWrite(req, env)) return reply({ error: 'unauthorized' }, 401);
        const { results } = await env.DB.prepare(
          `SELECT record, review_element_id, reviewed_at FROM jumps WHERE status IN ('confirmed','corrected') AND review_element_id IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1000`,
        ).all<{ record: string; review_element_id: string; reviewed_at: string }>();
        const records = results.map((r) => ({
          ...(JSON.parse(r.record) as object),
          figure: { elementId: r.review_element_id, labeledAt: r.reviewed_at },
        }));
        return reply({ records });
      }

      if (!canReview(req, env)) return reply({ error: 'unauthorized' }, 401);

      if (path === '/jumps' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        if (status && !(STATUSES as readonly string[]).includes(status)) return reply({ error: 'unknown status' }, 400);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        // The queue: what is not reviewed yet, the unclassified first, then the least confident: those teach the classifier the most.
        const order =
          url.searchParams.get('queue') === '1'
            ? `auto_skill = 'unclassified' DESC, auto_confidence ASC`
            : `updated_at DESC`;
        const where = url.searchParams.get('queue') === '1' ? `status = 'auto'` : status ? `status = ?1` : '1 = 1';
        const stmt = env.DB.prepare(`SELECT ${SUMMARY} FROM jumps WHERE ${where} ORDER BY ${order} LIMIT ${limit}`);
        const { results } = await (where.includes('?1') ? stmt.bind(status) : stmt).all();
        return reply({ jumps: results });
      }

      if (path === '/stats' && req.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM jumps GROUP BY status`).all();
        return reply({ stats: results });
      }

      if (path === '/export' && req.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT ${SUMMARY}, record FROM jumps ORDER BY id`).all<
          Record<string, unknown> & { record: string }
        >();
        const lines = results.map((r) => JSON.stringify({ ...r, record: JSON.parse(r.record) }));
        return new Response(lines.join('\n'), { headers: { 'content-type': 'application/x-ndjson', ...h } });
      }

      const one = /^\/jumps\/([^/]+)$/.exec(path);
      const review = /^\/jumps\/([^/]+)\/review$/.exec(path);

      if (one && req.method === 'GET') {
        const row = await env.DB.prepare(`SELECT ${SUMMARY}, record FROM jumps WHERE id = ?1`)
          .bind(decodeURIComponent(one[1]))
          .first<Record<string, unknown> & { record: string }>();
        return row ? reply({ ...row, record: JSON.parse(row.record) }) : reply({ error: 'not found' }, 404);
      }

      if (review && req.method === 'PUT') {
        const id = decodeURIComponent(review[1]);
        const row = await env.DB.prepare(`SELECT auto_element_id FROM jumps WHERE id = ?1`)
          .bind(id)
          .first<{ auto_element_id: string | null }>();
        if (!row) return reply({ error: 'not found' }, 404);
        const parsed = parseReview(await req.json().catch(() => null), row.auto_element_id);
        if (!parsed.ok) return reply({ error: parsed.error }, 400);
        const v = parsed.value;
        await env.DB.prepare(
          `UPDATE jumps SET status = ?2, review_element_id = ?3, review_note = ?4, reviewer = ?5, reviewed_at = ?6 WHERE id = ?1`,
        )
          .bind(id, v.status, v.review_element_id, v.review_note, v.reviewer, new Date().toISOString())
          .run();
        return reply({ id, ...v });
      }

      return reply({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return reply({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
