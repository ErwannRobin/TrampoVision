// Copies the MediaPipe and ffmpeg WASM runtimes and downloads the pose models into public/,
// so the app runs fully offline after install. Non-fatal: a failed download only
// prints a warning (re-run with `npm run fetch-assets`).
import { cpSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDir = join(root, 'public/models');
const ffmpegSrc = join(root, 'node_modules/@ffmpeg/core/dist/esm');
const ffmpegDst = join(root, 'public/ffmpeg');

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = ['lite', 'full', 'heavy'];

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[assets] copied MediaPipe wasm ->', wasmDst);
} else {
  console.warn('[assets] node_modules/@mediapipe/tasks-vision not found; run npm install first');
}

// ffmpeg.wasm converts videos the browser cannot decode (iPhone HEVC in Chrome) to H.264, in the browser.
if (existsSync(ffmpegSrc)) {
  mkdirSync(ffmpegDst, { recursive: true });
  cpSync(ffmpegSrc, ffmpegDst, { recursive: true });
  console.log('[assets] copied ffmpeg wasm ->', ffmpegDst);
} else {
  console.warn('[assets] node_modules/@ffmpeg/core not found; run npm install first');
}

mkdirSync(modelDir, { recursive: true });
for (const variant of MODELS) {
  const file = join(modelDir, `pose_landmarker_${variant}.task`);
  if (existsSync(file) && statSync(file).size > 1_000_000) continue;
  const url = `${MODEL_BASE}/pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('[assets] downloaded', variant, 'model');
  } catch (err) {
    console.warn(`[assets] could not download ${variant} model (${err.message}). Run "npm run fetch-assets" later.`);
  }
}
