import { t } from '../i18n/core';

/**
 * What this browser can run for a 3D pose model, measured (not assumed). The result is shown in the 3D panel.
 * MediaPipe Tasks Vision runs its "GPU" delegate on WebGL and its "CPU" delegate on WebAssembly (XNNPACK); it does not use WebGPU.
 */
export interface Capabilities {
  /** 'available': an adapter was obtained; 'no-adapter': the API exists but no GPU adapter (blocklist, headless); 'unsupported': no navigator.gpu. */
  webgpu: 'available' | 'no-adapter' | 'unsupported';
  webgl2: boolean;
  wasm: boolean;
  wasmSimd: boolean;
  /** SharedArrayBuffer + cross-origin isolation: needed for multi-threaded WebAssembly. */
  wasmThreads: boolean;
  cores: number | null;
  deviceMemoryGb: number | null;
}

/** The smallest WebAssembly module that uses a SIMD instruction (the check used by wasm-feature-detect). */
const SIMD_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export async function probeCapabilities(): Promise<Capabilities> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    (Navigator & { gpu?: { requestAdapter(): Promise<unknown> }; deviceMemory?: number }) | undefined;
  let webgpu: Capabilities['webgpu'] = 'unsupported';
  if (nav?.gpu) {
    try {
      webgpu = (await nav.gpu.requestAdapter()) ? 'available' : 'no-adapter';
    } catch {
      webgpu = 'no-adapter';
    }
  }
  let webgl2 = false;
  try {
    webgl2 = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  const wasm = typeof WebAssembly !== 'undefined';
  let wasmSimd = false;
  try {
    wasmSimd = wasm && WebAssembly.validate(SIMD_MODULE);
  } catch {
    wasmSimd = false;
  }
  return {
    webgpu,
    webgl2,
    wasm,
    wasmSimd,
    wasmThreads:
      typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: nav?.hardwareConcurrency ?? null,
    deviceMemoryGb: nav?.deviceMemory ?? null,
  };
}

export interface SupportVerdict {
  /** The 3D landmarks of the model already in the app. */
  current: { ok: boolean; text: string };
  /** A separate, dedicated 3D model (a lifting network) run through onnxruntime-web. Not built; this says whether the browser could host it. */
  dedicated: { ok: boolean; text: string };
}

export function describeSupport(c: Capabilities, hasWorld: boolean): SupportVerdict {
  const runtime = t(c.webgl2 ? 'cap.runtime.webgl' : c.wasm ? 'cap.runtime.wasm' : 'cap.runtime.none');
  const current = hasWorld
    ? { ok: true, text: t(c.wasmSimd ? 'cap.current.okSimd' : 'cap.current.ok', { runtime }) }
    : { ok: false, text: t('cap.current.none') };
  const noAdapter = c.webgpu === 'no-adapter';
  const dedicated =
    c.webgpu === 'available'
      ? { ok: true, text: t('cap.dedicated.webgpu') }
      : c.wasm
        ? {
            ok: true,
            text: t(
              noAdapter
                ? c.wasmThreads
                  ? 'cap.dedicated.noAdapterThreads'
                  : 'cap.dedicated.noAdapterSingle'
                : c.wasmThreads
                  ? 'cap.dedicated.noWebgpuThreads'
                  : 'cap.dedicated.noWebgpuSingle',
            ),
          }
        : { ok: false, text: t('cap.dedicated.none') };
  return { current, dedicated };
}
