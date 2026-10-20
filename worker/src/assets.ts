import { objectResponse } from './r2';

/**
 * The app's big files: pose models, wasm runtimes, sample videos and their saved analysis (layout: scripts/assets-upload.mjs). The
 * app reads them at VITE_ASSET_BASE_URL = <this Worker>/assets. They are in R2 because R2 charges nothing for the bytes served (the
 * Vercel Blob store they were in charged for each download). Read only: the upload goes through R2's S3 API, with its own token. Each
 * file carries the cache time it was uploaded with: a year for a model or a wasm (the version is in the path), less for the samples.
 */

export interface AssetEnv {
  ASSETS: R2Bucket;
}

/** Each segment: letters, digits, `_`, `-`, `.` and spaces, never starting with a dot (no `..`, no hidden file). */
const SEGMENT = /^[\w-][\w. -]*$/;

/** The key in the bucket for the path after /assets/, or null when it is not one. */
export function assetKey(rest: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return key.split('/').every((s) => SEGMENT.test(s)) ? key : null;
}

type Reply = (body: unknown, status?: number) => Response;

/** GET and HEAD of /assets/<key>, or null for any other path. `cors`: the headers for the calling origin. */
export async function handleAssets(
  req: Request,
  env: AssetEnv,
  path: string,
  cors: Record<string, string>,
  reply: Reply,
): Promise<Response | null> {
  if (!path.startsWith('/assets/')) return null;
  const key = assetKey(path.slice('/assets/'.length));
  if (!key || (req.method !== 'GET' && req.method !== 'HEAD')) return reply({ error: 'not found' }, 404);
  const object =
    req.method === 'HEAD'
      ? await env.ASSETS.head(key)
      : await env.ASSETS.get(key, { range: req.headers, onlyIf: req.headers });
  if (!object) return reply({ error: 'not found' }, 404);

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  return objectResponse(req, object, headers);
}
