import { describe, expect, it, vi } from 'vitest';
import type { PoseDetection, PoseEstimator, PoseEstimatorFactory } from '../pose/types';
import type { MaskLayer } from './layer';
import { withMotionMask } from './maskedEstimator';
import type { MotionResult } from './types';

const video = { videoWidth: 640, videoHeight: 360 } as HTMLVideoElement;
const masked = { masked: true } as unknown as HTMLCanvasElement;
const detections: PoseDetection[] = [{ landmarks: [{ x: 0.5, y: 0.5, visibility: 1 }] }];

/** What the detector says about a frame, with the mask covering this share of the picture. */
function frame(coverage: number): MotionResult {
  const n = 4;
  return {
    width: 2,
    height: 2,
    motion: new Float32Array(n),
    evidence: new Float32Array(n),
    rhythm: new Float32Array(2),
    mask: new Float32Array(n).fill(coverage),
    found: coverage < 1,
    periodS: null,
    rhythmFit: 0,
    coverage,
    noise: 0,
    shift: 0,
    camera: { type: 'fixed', dx: 0, dy: 0, known: false, speed: 0 },
  };
}

/** A pose estimator that records what it was given, and a layer that says what it is told to. */
function setup(says: (MotionResult | null | Error)[]) {
  const given: unknown[] = [];
  const times: number[] = [];
  const estimator: PoseEstimator = {
    backend: { engine: 'fake', delegate: 'CPU', webgpuAvailable: false },
    detect: (source, timestampMs) => {
      given.push(source);
      times.push(timestampMs);
      return detections;
    },
    dispose: vi.fn(),
  };
  let call = 0;
  const layer: MaskLayer = {
    process: vi.fn(() => {
      const next = says[Math.min(call++, says.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    }),
    render: vi.fn(() => masked),
    dispose: vi.fn(),
  };
  const inner: PoseEstimatorFactory = async () => estimator;
  const seen: (MotionResult | null)[] = [];
  const factory = withMotionMask(inner, { layer: () => layer, onFrame: (r) => seen.push(r) });
  return { factory, given, times, estimator, layer, seen };
}

const options = { model: 'full', numPoses: 1, preferGpu: false } as const;

describe('the motion mask in front of a pose estimator', () => {
  it('gives the pose model the masked picture while the detector hides part of the frame', async () => {
    const { factory, given, layer } = setup([frame(0.4)]);
    const estimator = await factory(options);
    expect(estimator.detect(video, 1000)).toBe(detections);
    expect(given).toEqual([masked]);
    expect(layer.render).toHaveBeenCalledWith(video);
  });

  it('gives it the video itself while nothing is hidden, and when the frame could not be read', async () => {
    const { factory, given, layer } = setup([frame(1), null]);
    const estimator = await factory(options);
    estimator.detect(video, 1000);
    estimator.detect(video, 1033);
    expect(given).toEqual([video, video]);
    expect(layer.render).not.toHaveBeenCalled();
  });

  it('passes the time of the frame on, and tells the debug view what was found', async () => {
    const found = frame(0.5);
    const { factory, times, seen } = setup([found]);
    const estimator = await factory(options);
    estimator.detect(video, 1234);
    expect(times).toEqual([1234]);
    expect(seen).toEqual([found]);
  });

  it('switches itself off when the layer fails, and the pose model still gets every frame', async () => {
    const { factory, given, layer } = setup([frame(0.4), new Error('canvas lost'), frame(0.4)]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const estimator = await factory(options);
    estimator.detect(video, 1000);
    estimator.detect(video, 1033);
    estimator.detect(video, 1066);
    expect(given).toEqual([masked, video, video]);
    expect(layer.process).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reports the backend of the pose model and disposes of both', async () => {
    const { factory, estimator: inner, layer } = setup([frame(1)]);
    const estimator = await factory(options);
    expect(estimator.backend).toBe(inner.backend);
    estimator.dispose();
    expect(layer.dispose).toHaveBeenCalled();
    expect(inner.dispose).toHaveBeenCalled();
  });

  it('refuses the engines that cannot read a canvas', async () => {
    const { factory } = setup([frame(1)]);
    await expect(factory({ ...options, engine: 'rtmpose' })).rejects.toThrow(/MediaPipe/);
    await expect(factory({ ...options, engine: 'mediapipe' })).resolves.toBeDefined();
  });
});
