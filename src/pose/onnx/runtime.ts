import type * as Ort from 'onnxruntime-web';
import { t } from '../../i18n/core';
import { assetBase, ORT_VERSION } from '../../assets';
// Built as files of the app: the CSP lets scripts come from this origin only, and the build puts them next to the page.
import ortLoader from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';

type OrtModule = typeof Ort;

const BASE = import.meta.env.BASE_URL;
let ortPromise: Promise<OrtModule> | null = null;

/**
 * ONNX Runtime Web, loaded the first time an experimental pose engine is picked (MediaPipe users never download it). The script is
 * part of the build, with its loader; the wasm (~28 MB) is read from the asset host when there is one, else from the build.
 */
export function loadOrt(): Promise<OrtModule> {
  ortPromise ??= import('onnxruntime-web').then((ort) => {
    // The runtime that has WebGPU (it also runs on WebAssembly). Only the wasm may come from the asset host.
    ort.env.wasm.wasmPaths = {
      mjs: ortLoader,
      wasm: assetBase ? `${assetBase}ort/${ORT_VERSION}/ort-wasm-simd-threaded.jsep.wasm` : ortWasm,
    };
    return ort;
  });
  return ortPromise;
}

export function modelUrl(file: string): string {
  return `${assetBase ?? BASE}models/${file}`;
}

const fetched = new Map<string, Promise<Uint8Array>>();

/** Bytes received so far and the size of the file (0 when the server does not tell it). */
export type ByteProgress = (loaded: number, total: number) => void;

/**
 * The bytes of a model file. A missing file is told clearly (a dev server answers an unknown path with the page itself).
 * `onBytes` follows the download; a file already fetched reports itself done at once.
 */
export function fetchModel(file: string, onBytes?: ByteProgress): Promise<Uint8Array> {
  let bytes = fetched.get(file);
  if (bytes) {
    void bytes.then((done) => onBytes?.(done.length, done.length)).catch(() => {});
    return bytes;
  }
  bytes = (async () => {
    const res = await fetch(modelUrl(file));
    const html = res.headers.get('content-type')?.includes('text/html');
    if (!res.ok || html) throw new Error(t('err.modelFile', { file }));
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
    onBytes(0, total);
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onBytes(loaded, total);
    }
    const all = new Uint8Array(loaded);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk, at);
      at += chunk.length;
    }
    return all;
  })();
  bytes.catch(() => fetched.delete(file));
  fetched.set(file, bytes);
  return bytes;
}

export interface OnnxSession {
  session: Ort.InferenceSession;
  provider: 'webgpu' | 'wasm';
  /** Why WebGPU was asked for and not used. */
  fallbackReason?: string;
}

/**
 * A session on WebGPU when asked and possible, else on WebAssembly. WebGPU can be created and still fail on the first run
 * (blocked adapter, unsupported operator), so `warmup` runs the model once and a failure moves it to WebAssembly.
 */
export async function createSession(
  ort: OrtModule,
  file: string,
  preferGpu: boolean,
  warmup: (session: Ort.InferenceSession) => Promise<unknown>,
): Promise<OnnxSession> {
  const bytes = await fetchModel(file);
  let fallbackReason: string | undefined;
  if (preferGpu && typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
      await warmup(session);
      return { session, provider: 'webgpu' };
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
      console.warn(`[pose] WebGPU failed for ${file}, falling back to WebAssembly:`, err);
    }
  } else if (preferGpu) {
    fallbackReason = 'WebGPU is not available in this browser';
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  await warmup(session);
  return { session, provider: 'wasm', fallbackReason };
}
