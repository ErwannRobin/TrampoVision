// Shared by assets-upload.mjs, asset-remove.mjs and assets-remove.mjs: the R2 bucket of the assets (through R2's S3 API), its listing
// and the samples index. The app reads the bucket through the review Worker (worker/src/assets.ts), never through this API.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// loadEnvFile never overrides a variable that is already set, so an exported token wins over .env.local, which wins over .env.
for (const f of ['.env.local', '.env']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));

const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
const Bucket = process.env.R2_ASSETS_BUCKET || 'trampovision-assets';

export const hasToken = !!(account && accessKeyId && secretAccessKey);
export const tokenHelp =
  'set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (an R2 API token with Object Read & Write on the bucket, see .env.example)';

const s3 = hasToken
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

const worker = process.env.VITE_REVIEW_API_URL?.trim().replace(/\/+$/, '');
/** Where the app reads the bucket: the value of VITE_ASSET_BASE_URL. */
export const publicBase = `${worker || '<review Worker URL>'}/assets`;

/** Everything the bucket holds: pathname -> { size }. */
export async function listStore() {
  const blobs = new Map();
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken }));
    for (const o of page.Contents ?? []) blobs.set(o.Key, { size: o.Size });
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { blobs };
}

/** Writes one file, in parts when it is big (one request of the S3 API takes at most 5 GB, wrangler at most 315 MB). */
export async function putObject(pathname, body, contentType, maxAge) {
  await new Upload({
    client: s3,
    params: { Bucket, Key: pathname, Body: body, ContentType: contentType, CacheControl: `public, max-age=${maxAge}` },
    partSize: 64 * 1024 * 1024,
    queueSize: 4,
  }).done();
}

/**
 * The browser cannot list a bucket, so the app reads samples/index.json ({"files": [...]}, see src/video/sample.ts).
 * It is rebuilt from what the bucket holds right now, and only written when it changed.
 */
export async function writeSampleIndex(tag) {
  const { blobs } = await listStore();
  const files = [...blobs.keys()]
    .filter((p) => /^samples\/[^/]+(\.(mp4|mov)|\.pose\.json)$/i.test(p))
    .map((p) => p.slice('samples/'.length))
    .sort();
  const index = JSON.stringify({ files }, null, 2);
  const current = blobs.has('samples/index.json')
    ? await s3
        .send(new GetObjectCommand({ Bucket, Key: 'samples/index.json' }))
        .then((r) => r.Body.transformToString())
        .catch(() => '')
    : '';
  if (current === index) {
    console.log(`[${tag}] samples/index.json already up to date`);
    return;
  }
  // The one file that changes: a new sample shows up within a minute.
  await putObject('samples/index.json', index, 'application/json', 60);
  console.log(`[${tag}] samples/index.json -> ${files.length} sample file(s)`);
}

/** Prints, then deletes (unless dryRun) the given pathnames of `blobs`, and refreshes the samples index when a sample went. */
export async function deleteFromStore(blobs, targets, dryRun) {
  for (const pathname of targets) {
    console.log(
      `[remove] ${dryRun ? 'would delete' : 'deleting'} ${pathname} (${(blobs.get(pathname).size / 1e6).toFixed(1)} MB)`,
    );
  }
  if (dryRun) return;
  const keys = [...targets];
  // At most 1000 keys per request.
  for (let i = 0; i < keys.length; i += 1000) {
    const Objects = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    const res = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects } }));
    if (res.Errors?.length) throw new Error(`delete failed: ${res.Errors.map((e) => `${e.Key} ${e.Code}`).join(', ')}`);
  }
  if (keys.some((p) => p.startsWith('samples/'))) await writeSampleIndex('remove');
  console.log(`[remove] done. A copy cached by a browser (a year for the files) can outlive the delete for a while.`);
}
