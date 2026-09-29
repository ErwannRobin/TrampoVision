import { describe, expect, it } from 'vitest';
import { describeSupport, type Capabilities } from './capabilities';

const base: Capabilities = {
  webgpu: 'available',
  webgl2: true,
  wasm: true,
  wasmSimd: true,
  wasmThreads: false,
  cores: 8,
  deviceMemoryGb: 8,
};

describe('describeSupport', () => {
  it('says the current model already has 3D and names the runtime it uses', () => {
    const v = describeSupport(base, true);
    expect(v.current.ok).toBe(true);
    expect(v.current.text).toContain('WebGL');
    expect(v.dedicated.ok).toBe(true);
  });
  it('says so when the saved data has no 3D', () => {
    expect(describeSupport(base, false).current.ok).toBe(false);
  });
  it('is honest about a WASM-only fallback', () => {
    const v = describeSupport({ ...base, webgpu: 'unsupported', webgl2: false }, true);
    expect(v.current.text).toContain('WebAssembly');
    expect(v.dedicated.text).toContain('not available');
    expect(v.dedicated.text).toContain('without threads');
  });
  it('reports that nothing can run', () => {
    expect(
      describeSupport({ ...base, webgpu: 'unsupported', wasm: false, wasmSimd: false, webgl2: false }, true).dedicated
        .ok,
    ).toBe(false);
  });
});
