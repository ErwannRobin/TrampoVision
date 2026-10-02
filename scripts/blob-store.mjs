// Shared by upload-assets.mjs and remove-asset.mjs: the token, the listing of the Blob store and the samples index.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// loadEnvFile never overrides a variable that is already set, so an exported token wins over .env.local, which wins over .env.
for (const f of ['.env.local', '.env']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));

export const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;

/** Everything the store holds: pathname -> { size, url }, and its public origin ('' when it is empty). */
export async function listStore() {
  const blobs = new Map();
  let base = '';
  let cursor;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      blobs.set(b.pathname, { size: b.size, url: b.url });
      base ||= b.url.slice(0, b.url.length - b.pathname.length);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { blobs, base };
}

/**
 * The browser cannot list a store, so the app reads samples/index.json ({"files": [...]}, see src/video/sample.ts).
 * It is rebuilt from what the store holds right now, and only written when it changed.
 */
export async function writeSampleIndex(tag) {
  const { blobs, base } = await listStore();
  const files = [...blobs.keys()]
    .filter((p) => /^samples\/[^/]+(\.(mp4|mov)|\.pose\.json)$/i.test(p))
    .map((p) => p.slice('samples/'.length))
    .sort();
  const index = JSON.stringify({ files }, null, 2);
  const current = blobs.has('samples/index.json')
    ? await fetch(`${base}samples/index.json`, { cache: 'no-store' })
        .then((r) => r.text())
        .catch(() => '')
    : '';
  if (current === index) {
    console.log(`[${tag}] samples/index.json already up to date`);
    return;
  }
  await put('samples/index.json', index, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60, // the one file that changes: a new sample shows up within a minute
  });
  console.log(`[${tag}] samples/index.json -> ${files.length} sample file(s)`);
}
