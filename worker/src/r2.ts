/** Serving a file from R2, for the shared clips and the app's assets: ranges (a video that seeks), a cached copy (304) and HEAD. */

/** The part of a file of `size` bytes that R2 served, as a Content-Range value. */
export function contentRange(range: R2Range, size: number): string {
  const { offset, length, suffix } = range as { offset?: number; length?: number; suffix?: number };
  const start = suffix !== undefined ? Math.max(size - suffix, 0) : (offset ?? 0);
  const end = suffix !== undefined ? size - 1 : length !== undefined ? Math.min(start + length, size) - 1 : size - 1;
  return `bytes ${start}-${end}/${size}`;
}

/**
 * The response for what `head` or `get(key, { range: req.headers, onlyIf: req.headers })` returned. `headers` already holds the
 * CORS, type and caching headers; this adds the ETag, the length and the range.
 */
export function objectResponse(req: Request, object: R2Object | R2ObjectBody, headers: Headers): Response {
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
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
