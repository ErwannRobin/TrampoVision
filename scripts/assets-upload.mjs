// Uploads the big files to a public Vercel Blob store, so the deployment does not carry them (see src/assets.ts).
//
//   npm run assets-upload                                      upload everything (token from BLOB_READ_WRITE_TOKEN, else .env.local, else .env)
//   npm run assets-upload -- --force                           also re-upload what is already in the store (by default it is skipped)
//   npm run assets-upload -- --dry-run                         list what would be uploaded
//   npm run assets-upload -- --samples path/to/videos          folder with IMG_8368.mp4, IMG_8368.MOV and dong-dong-2011-landscape.mp4 (default: video-sample/)
//
// Layout under the store (what the app reads):
//   models/pose_landmarker_{lite,full,heavy}.task
//   mediapipe/<tasks-vision version>/vision_wasm_internal.wasm, vision_wasm_nosimd_internal.wasm
//   ffmpeg/<@ffmpeg/core version>/ffmpeg-core.wasm
//   ort/<onnxruntime-web version>/ort-wasm-simd-threaded.jsep.wasm
//   models/yolox_s.onnx, rtmpose_m_halpe26.onnx, vitpose_base_simple.onnx   (experimental pose engines; only the ones in public/models)
//   samples/<name>.mp4|.MOV   any video of the sample folder (a .mp4 and a .MOV of the same name are one clip)
//   samples/<name>.pose.json  the saved analysis of that clip (npm run precompute-samples): the app opens it instead of running the pose model
//   samples/index.json        {"files": [...]}: the sample file names in the store, rewritten at each run; the app reads it to list the samples
// Run it again after upgrading @mediapipe/tasks-vision, onnxruntime-web or @ffmpeg/core: the new version gets its own folder.
// At the end it prints the value for VITE_ASSET_BASE_URL.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import { hasToken, listStore, root, writeSampleIndex } from './blob-store.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const samplesFlag = args.indexOf('--samples');
const samplesDir = samplesFlag >= 0 ? args[samplesFlag + 1] : join(root, 'video-sample');

const version = (pkg) => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const contentTypes = {
  '.wasm': 'application/wasm', // required for streaming compilation
  '.task': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
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

files.push([
  `ort/${version('onnxruntime-web')}/ort-wasm-simd-threaded.jsep.wasm`,
  () => readFileSync(join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm')),
]);
for (const name of ['yolox_s.onnx', 'rtmpose_m_halpe26.onnx', 'vitpose_base_simple.onnx']) {
  const local = join(root, 'public/models', name);
  if (existsSync(local)) files.push([`models/${name}`, () => readFileSync(local)]);
  else console.warn(`[upload] ${name} is not in public/models (run npm run fetch-assets): skipped`);
}

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
  for (const name of readdirSync(samplesDir).filter((n) => /\.(mp4|mov)$/i.test(n) || n.endsWith('.pose.json'))) {
    files.push([`samples/${name}`, () => readFileSync(join(samplesDir, name))]);
  }
} else {
  console.warn(`[upload] no sample folder at ${samplesDir}: the sample videos are skipped (use --samples <folder>)`);
}

if (!dryRun && !hasToken) {
  console.error('[upload] set BLOB_READ_WRITE_TOKEN (the read-write token of the Blob store)');
  process.exit(1);
}

let base = '';
// pathname -> size of what the store already holds (empty without a token or with --force: everything is then uploaded)
const remote = new Map();
if (hasToken && !force) {
  const store = await listStore();
  base = store.base;
  for (const [pathname, { size }] of store.blobs) remote.set(pathname, size);
}
// Models and wasm have their version in the path, so a file that is there is the right one. A sample keeps its name when it is re-encoded: compare sizes.
const upToDate = (pathname, size) =>
  remote.has(pathname) && (!pathname.startsWith('samples/') || remote.get(pathname) === size);

if (dryRun) {
  for (const [pathname, read] of files) {
    const skip = pathname.startsWith('samples/') ? upToDate(pathname, (await read()).length) : upToDate(pathname);
    console.log(`[upload] would ${skip ? 'skip (already there)' : 'upload'}`, pathname);
  }
  process.exit(0);
}

for (const [pathname, read] of files) {
  // Look before downloading a model: a file that is already in the store is not fetched again.
  if (!pathname.startsWith('samples/') && upToDate(pathname)) {
    console.log(`[upload] ${pathname} already in the store, skipped`);
    continue;
  }
  const body = await read();
  if (upToDate(pathname, body.length)) {
    console.log(`[upload] ${pathname} already in the store, skipped`);
    continue;
  }
  const blob = await put(pathname, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: typeOf(pathname),
    // The version is in the path, so a file never changes. A saved analysis is rewritten when the video is analyzed again: an hour.
    cacheControlMaxAge: pathname.endsWith('.pose.json') ? 60 * 60 : 60 * 60 * 24 * 365,
    multipart: body.length > 20_000_000,
  });
  base = blob.url.slice(0, blob.url.length - pathname.length);
  console.log(`[upload] ${pathname} (${(body.length / 1e6).toFixed(1)} MB) -> ${blob.url}`);
}
if (hasToken && !dryRun) await writeSampleIndex('upload');
console.log(`\n[upload] done. Set VITE_ASSET_BASE_URL=${base.replace(/\/$/, '')} in the Vercel project.`);
