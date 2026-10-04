import { describe, expect, it, vi } from 'vitest';
import type { PoseDetection, PoseEstimator, PoseEstimatorFactory } from '../pose/types';
import type { MaskLayer } from './layer';
import { withMotionMask } from './maskedEstimator';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { Box, MotionResult } from './types';

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
    athletes: [],
    periodS: null,
    rhythmFit: 0,
    coverage,
    noise: 0,
    shift: 0,
    camera: { type: 'fixed', dx: 0, dy: 0, known: false, speed: 0, athleteShare: 0 },
  };
}

/** The same, for a picture of 100 × 100 pixels in which the athlete is in `athletes`. */
const frameWith = (coverage: number, athletes: Box[]): MotionResult => ({
  ...frame(coverage),
  width: 100,
  height: 100,
  found: athletes.length > 0,
  athletes,
});

/** A person whose hips are at (x, y) of the picture, 0 to 1. */
function person(x: number, y: number): PoseDetection {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y, visibility: 1 }));
  landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x, y, visibility: 1 };
  return { landmarks };
}

/** A pose estimator that records what it was given, and a layer that says what it is told to. */
function setup(
  says: (MotionResult | null | Error)[],
  people: PoseDetection[] | Promise<PoseDetection[]> = detections,
  extra = {},
) {
  const given: unknown[] = [];
  const times: number[] = [];
  const estimator: PoseEstimator = {
    backend: { engine: 'fake', delegate: 'CPU', webgpuAvailable: false },
    detect: (source, timestampMs) => {
      given.push(source);
      times.push(timestampMs);
      return people;
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
  const factory = withMotionMask(inner, { layer: () => layer, onFrame: (r) => seen.push(r), ...extra });
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

  describe('the person who jumps', () => {
    const athlete = person(0.5, 0.6);
    const coach = person(0.8, 0.8);
    const where = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];

    it('is the only person given back once the detector knows where they are', async () => {
      const { factory } = setup([frameWith(0.2, where)], [coach, athlete]);
      const estimator = await factory(options);
      expect(estimator.detect(video, 1000)).toEqual([athlete]);
    });

    it('is not told apart from the others while the detector does not know where they are', async () => {
      const { factory } = setup([frameWith(1, [])], [coach, athlete]);
      const estimator = await factory(options);
      expect(estimator.detect(video, 1000)).toEqual([coach, athlete]);
    });

    it('can be left out: everybody the pose model found is given back', async () => {
      const { factory } = setup([frameWith(0.2, where)], [coach, athlete], { focus: false });
      const estimator = await factory(options);
      expect(estimator.detect(video, 1000)).toEqual([coach, athlete]);
    });

    it('is picked out of what a pose model that answers later gives', async () => {
      const { factory } = setup([frameWith(0.2, where)], Promise.resolve([coach, athlete]));
      const estimator = await factory(options);
      await expect(estimator.detect(video, 1000)).resolves.toEqual([athlete]);
    });
  });

  describe('the view of the athlete', () => {
    const where = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];
    const zoomed = { name: 'a zoomed view' } as unknown as HTMLCanvasElement;
    const paint = vi.fn(() => zoomed as unknown as CanvasImageSource);

    it('gives the pose model a zoomed view of the athlete, and the people it finds are put back in the frame', async () => {
      // The athlete is in the middle of the view the pose model is given: they are where the box of the athlete is.
      const { factory, given } = setup([frameWith(0.2, where)], [person(0.5, 0.5)], { view: { zoom: true }, paint });
      const estimator = await factory(options);
      const found = estimator.detect(video, 1000) as PoseDetection[];
      expect(given).toEqual([zoomed]);
      expect(paint).toHaveBeenCalledTimes(1);
      // The middle of the box, which is 50.5 and 60.5 of a picture of 100.
      expect(found).toHaveLength(1);
      expect(found[0].landmarks[LM.L_HIP].x).toBeCloseTo(0.505, 6);
      expect(found[0].landmarks[LM.L_HIP].y).toBeCloseTo(0.605, 6);
    });

    it('gives the picture as it is while no athlete is found', async () => {
      const { factory, given } = setup([frameWith(1, [])], detections, { view: { zoom: true }, paint });
      const estimator = await factory(options);
      estimator.detect(video, 1000);
      expect(given).toEqual([video]);
    });

    it('does nothing to the picture when it is not asked to', async () => {
      const { factory, given } = setup([frameWith(0.2, where)], [person(0.5, 0.5)], { paint });
      const estimator = await factory(options);
      estimator.detect(video, 1000);
      expect(given).toEqual([masked]);
    });

    it('puts back what a pose model that answers later finds', async () => {
      const { factory } = setup([frameWith(0.2, where)], Promise.resolve([person(0.5, 0.5)]), {
        view: { zoom: true },
        paint,
      });
      const estimator = await factory(options);
      const found = await (estimator.detect(video, 1000) as Promise<PoseDetection[]>);
      expect(found[0].landmarks[LM.L_HIP].x).toBeCloseTo(0.505, 6);
    });
  });

  it('refuses the engines that cannot read a canvas', async () => {
    const { factory } = setup([frame(1)]);
    await expect(factory({ ...options, engine: 'rtmpose' })).rejects.toThrow(/MediaPipe/);
    await expect(factory({ ...options, engine: 'mediapipe' })).resolves.toBeDefined();
  });
});
