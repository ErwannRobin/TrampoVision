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
const SIMD_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export async function probeCapabilities(): Promise<Capabilities> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { gpu?: { requestAdapter(): Promise<unknown> }; deviceMemory?: number }) | undefined;
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
    wasmThreads: typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
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
  const runtime = c.webgl2 ? 'WebGL (GPU delegate)' : c.wasm ? 'WebAssembly (CPU delegate)' : 'no supported runtime';
  const current = hasWorld
    ? { ok: true, text: `Available. The MediaPipe pose model already returns 3D landmarks (BlazePose GHUM, in meters) with every frame, so no second model is loaded. It runs on ${runtime}${c.wasmSimd ? ', WASM SIMD on' : ''}.` }
    : { ok: false, text: 'This analysis has no 3D landmarks (data saved before 3D support). Analyze the video again.' };
  const dedicated =
    c.webgpu === 'available'
      ? { ok: true, text: 'A dedicated 3D model could run on WebGPU (through onnxruntime-web) in this browser. Not built: it needs a model file, and I have not tested any.' }
      : c.wasm
        ? { ok: true, text: `WebGPU is ${c.webgpu === 'no-adapter' ? 'present but has no GPU adapter' : 'not available'}, so a dedicated 3D model would fall back to WebAssembly${c.wasmThreads ? ' with threads' : ' without threads (the page is not cross-origin isolated), which is slow'}. Not built, not tested.` }
        : { ok: false, text: 'Neither WebGPU nor WebAssembly is available: no 3D model can run here.' };
  return { current, dedicated };
}
