// Uploads the big files to a public Vercel Blob store, so the deployment does not carry them (see src/assets.ts).
//
//   BLOB_READ_WRITE_TOKEN=... npm run upload-assets            upload everything
//   npm run upload-assets -- --dry-run                         list what would be uploaded
//   npm run upload-assets -- --samples path/to/videos          folder with IMG_8368.mp4, IMG_8368.MOV and dong-dong-2011-landscape.mp4 (default: video-sample/)
//
// Layout under the store (what the app reads):
//   models/pose_landmarker_{lite,full,heavy}.task
//   mediapipe/<tasks-vision version>/vision_wasm_internal.wasm, vision_wasm_nosimd_internal.wasm
//   ffmpeg/<@ffmpeg/core version>/ffmpeg-core.wasm
//   samples/IMG_8368.mp4, samples/IMG_8368.MOV, samples/dong-dong-2011-landscape.mp4
// Run it again after upgrading @mediapipe/tasks-vision or @ffmpeg/core: the new version gets its own folder.
// At the end it prints the value for VITE_ASSET_BASE_URL.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const samplesFlag = args.indexOf('--samples');
const samplesDir = samplesFlag >= 0 ? args[samplesFlag + 1] : join(root, 'video-sample');

const version = (pkg) => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const contentTypes = {
  '.wasm': 'application/wasm', // required for streaming compilation
  '.task': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};
const typeOf = (name) => contentTypes[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';

// [pathname in the store, () => bytes]
const files = [];

const mediapipe = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
for (const name of ['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm']) {
  files.push([`mediapipe/${version('@mediapipe/tasks-vision')}/${name}`, () => readFileSync(join(mediapipe, name))]);
}
files.push([
  `ffmpeg/${version('@ffmpeg/core')}/ffmpeg-core.wasm`,
  () => readFileSync(join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm')),
]);

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
for (const variant of ['lite', 'full', 'heavy']) {
  const name = `pose_landmarker_${variant}.task`;
  files.push([
    `models/${name}`,
    async () => {
      const local = join(root, 'public/models', name);
      if (existsSync(local)) return readFileSync(local);
      const res = await fetch(`${MODEL_BASE}/pose_landmarker_${variant}/float16/latest/${name}`);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  ]);
}

if (existsSync(samplesDir)) {
  for (const name of readdirSync(samplesDir).filter((n) => /\.(mp4|mov)$/i.test(n))) {
    files.push([`samples/${name}`, () => readFileSync(join(samplesDir, name))]);
  }
} else {
  console.warn(`[upload] no sample folder at ${samplesDir}: the sample videos are skipped (use --samples <folder>)`);
}

if (dryRun) {
  for (const [pathname] of files) console.log('[upload] would upload', pathname);
  process.exit(0);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('[upload] set BLOB_READ_WRITE_TOKEN (the read-write token of the Blob store)');
  process.exit(1);
}

let base = '';
for (const [pathname, read] of files) {
  const body = await read();
  const blob = await put(pathname, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: typeOf(pathname),
    cacheControlMaxAge: 60 * 60 * 24 * 365, // the version is in the path, so a file never changes
    multipart: body.length > 20_000_000,
  });
  base = blob.url.slice(0, blob.url.length - pathname.length);
  console.log(`[upload] ${pathname} (${(body.length / 1e6).toFixed(1)} MB) -> ${blob.url}`);
}
console.log(`\n[upload] done. Set VITE_ASSET_BASE_URL=${base.replace(/\/$/, '')} in the Vercel project.`);
