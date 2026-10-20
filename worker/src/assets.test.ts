import { describe, expect, it } from 'vitest';
import { assetKey } from './assets';

describe('assets', () => {
  it('reads the key of a file in the bucket', () => {
    expect(assetKey('models/pose_landmarker_full.task')).toBe('models/pose_landmarker_full.task');
    expect(assetKey('mediapipe/1.0.1/vision_wasm_internal.wasm')).toBe('mediapipe/1.0.1/vision_wasm_internal.wasm');
    expect(assetKey('samples/IMG%208368.MOV')).toBe('samples/IMG 8368.MOV');
  });

  it.each([
    ['an empty path', ''],
    ['a folder', 'models/'],
    ['a parent folder', 'models/../secret'],
    ['an encoded parent folder', 'samples/%2E%2E/x'],
    ['a hidden file', 'samples/.env'],
    ['a broken escape', 'samples/%E0%A4%A'],
    ['a double slash', 'models//x.task'],
  ])('refuses %s', (_, rest) => {
    expect(assetKey(rest)).toBeNull();
  });
});
