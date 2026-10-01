// Copies the MediaPipe WASM runtime and downloads the pose models into public/,
// so the app runs fully offline after install. Non-fatal: a failed download only
// prints a warning (re-run with `npm run fetch-assets`).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
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

// Experimental pose engines (see src/pose/onnx/). [file in public/models, url, file inside the zip when the url is a zip]
const OPENMMLAB = 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk';
const EXPERIMENTAL = [
  // The detector: official YOLOX-s (COCO), 640 x 640.
  ['yolox_s.onnx', 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx'],
  // RTMPose-m, Halpe 26 points (feet included). The zip holds end2end.onnx.
  [
    'rtmpose_m_halpe26.onnx',
    `${OPENMMLAB}/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip`,
    'end2end.onnx',
  ],
  // ViTPose-B, COCO 17 points (ONNX export for transformers.js).
  ['vitpose_base_simple.onnx', 'https://huggingface.co/Xenova/vitpose-base-simple/resolve/main/onnx/model.onnx'],
];
for (const [name, url, inZip] of EXPERIMENTAL) {
  const file = join(modelDir, name);
  if (existsSync(file) && statSync(file).size > 1_000_000) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let bytes = Buffer.from(await res.arrayBuffer());
    if (inZip) {
      const entry = Object.entries(unzipSync(new Uint8Array(bytes))).find(([path]) => path.endsWith(inZip));
      if (!entry) throw new Error(`${inZip} is not in the zip`);
      bytes = Buffer.from(entry[1]);
    }
    writeFileSync(file, bytes);
    console.log('[assets] downloaded', name);
  } catch (err) {
    console.warn(`[assets] could not download ${name} (${err.message}). Only the experimental pose engines need it.`);
  }
}
