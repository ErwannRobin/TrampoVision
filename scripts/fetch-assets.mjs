// Copies the MediaPipe WASM runtime and downloads the pose models into public/,
// so the app runs fully offline after install. Non-fatal: a failed download only
// prints a warning (re-run with `npm run fetch-assets`).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDir = join(root, 'public/models');

// When the build reads the big files from an asset host, only the small loader scripts are needed here.
const hosted = Boolean(process.env.VITE_ASSET_BASE_URL);

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = ['lite', 'full', 'heavy'];

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  // The "module" runtime (~11 MB) is only used by forVisionTasks(path, true); the app never asks for it, so it
  // would only add to every deployment.
  cpSync(wasmSrc, wasmDst, {
    recursive: true,
    filter: (src) => !src.includes('_module_') && !(hosted && src.endsWith('.wasm')),
  });
  for (const stale of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
    rmSync(join(wasmDst, stale), { force: true });
  }
  console.log('[assets] copied MediaPipe wasm ->', wasmDst);
} else {
  console.warn('[assets] node_modules/@mediapipe/tasks-vision not found; run npm install first');
}

if (hosted) {
  console.log('[assets] VITE_ASSET_BASE_URL is set: models and wasm are read from there, not downloaded');
  process.exit(0);
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
