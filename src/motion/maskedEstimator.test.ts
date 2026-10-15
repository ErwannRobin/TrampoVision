import { describe, expect, it, vi } from 'vitest';
import type { PoseDetection, PoseEstimator, PoseEstimatorFactory } from '../pose/types';
import type { MaskLayer } from './layer';
import { FollowWatch, withMotionMask } from './maskedEstimator';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { Box, MotionResult } from './types';
import { toView, type View } from './view';

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
    bodies: [],
    periodS: null,
    rhythmFit: 0,
    coverage,
    noise: 0,
    shift: 0,
    camera: { type: 'fixed', dx: 0, dy: 0, known: false, speed: 0, athleteShare: 0 },
  };
}

/** The same, for a picture of 100 × 100 pixels in which the athlete is in `athletes`: small enough on a steady shot for the zoom view. */
const frameWith = (coverage: number, athletes: Box[], camera: Partial<MotionResult['camera']> = {}): MotionResult => ({
  ...frame(coverage),
  width: 100,
  height: 100,
  found: athletes.length > 0,
  athletes,
  camera: { type: 'fixed', dx: 0, dy: 0, known: true, speed: 0, athleteShare: 0.2, ...camera },
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
  people: PoseDetection[] | Promise<PoseDetection[]> | (() => PoseDetection[]) = detections,
  extra = {},
) {
  const given: unknown[] = [];
  const times: number[] = [];
  const estimator: PoseEstimator = {
    backend: { engine: 'fake', delegate: 'CPU', webgpuAvailable: false },
    detect: (source, timestampMs) => {
      given.push(source);
      times.push(timestampMs);
      return typeof people === 'function' ? people() : people;
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
    seeBodies: vi.fn(),
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

    it('is kept in the next mask where the pose model found them, and the coach is not', async () => {
      const { factory, layer } = setup([frameWith(0.2, where)], [coach, athlete]);
      const estimator = await factory(options);
      estimator.detect(video, 1000);
      // The box around the skeleton, in the 100 × 100 picture of the detector: here every point is at the hips.
      expect(layer.seeBodies).toHaveBeenCalledWith([{ x0: 50, y0: 60, x1: 50, y1: 60 }]);
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

    it('is the person whose hips travel like a jumper, even when the motion box sits on a spotter', async () => {
      // A person with real shoulders and hips, so the travel of the hips can be followed from frame to frame.
      const body = (x: number, y: number, torso: number): PoseDetection => {
        const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: y - torso / 2, visibility: 1 }));
        landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x, y, visibility: 1 };
        landmarks[LM.L_SHOULDER] = landmarks[LM.R_SHOULDER] = { x, y: y - torso, visibility: 1 };
        return { landmarks };
      };
      const jumper = (t: number) => body(0.3, 0.55 - 0.3 * Math.abs(Math.sin((Math.PI * t) / 1.6)), 0.08);
      const spotter = body(0.52, 0.8, 0.2);
      // The detector's box joined the spotter and a post: the box alone would follow the spotter.
      const boxOnSpotter = [{ x0: 42, y0: 70, x1: 62, y1: 95 }];
      let now = 0;
      const { factory } = setup([frameWith(0.2, boxOnSpotter)], () => [spotter, jumper(now / 1000)]);
      const estimator = await factory(options);
      let last: PoseDetection[] = [];
      for (now = 0; now < 8000; now += 33) last = estimator.detect(video, now) as PoseDetection[];
      expect(last).toHaveLength(1);
      expect(last[0].landmarks[LM.L_HIP].x).toBeCloseTo(0.3);
    });

    it('trusts the travel alone when asked: nobody is given back before it knows, the spotter in the box least of all', async () => {
      const body = (x: number, y: number, torso: number): PoseDetection => {
        const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: y - torso / 2, visibility: 1 }));
        landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x, y, visibility: 1 };
        landmarks[LM.L_SHOULDER] = landmarks[LM.R_SHOULDER] = { x, y: y - torso, visibility: 1 };
        return { landmarks };
      };
      const jumper = (t: number) => body(0.3, 0.55 - 0.3 * Math.abs(Math.sin((Math.PI * t) / 1.6)), 0.08);
      const spotter = body(0.52, 0.8, 0.2);
      const boxOnSpotter = [{ x0: 42, y0: 70, x1: 62, y1: 95 }];
      let now = 0;
      const { factory } = setup([frameWith(0.2, boxOnSpotter)], () => [spotter, jumper(now / 1000)], {
        focus: 'travel',
      });
      const estimator = await factory(options);
      const first = estimator.detect(video, 0) as PoseDetection[];
      expect(first).toEqual([]);
      let last: PoseDetection[] = [];
      for (now = 33; now < 8000; now += 33) last = estimator.detect(video, now) as PoseDetection[];
      expect(last).toHaveLength(1);
      expect(last[0].landmarks[LM.L_HIP].x).toBeCloseTo(0.3);
    });

    it('lets everybody through on a camera that follows the athlete, even when asked for the travel alone', async () => {
      // The camera keeps the athlete still in the picture: their hips never travel, and the travel would never answer.
      // Once it has moved at a follow camera's speed for a second, the clip is a follow clip: the app's tracker chooses.
      const still = person(0.5, 0.6);
      const judge = person(0.9, 0.8);
      const boxOnAthlete = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];
      const { factory } = setup([frameWith(0.2, boxOnAthlete, { type: 'tracking', speed: 0.4 })], [judge, still], {
        focus: 'travel',
      });
      const estimator = await factory(options);
      // Before the camera has followed for a second, the travel knows nothing and the frames stay empty.
      expect(estimator.detect(video, 0)).toEqual([]);
      let last: PoseDetection[] = [];
      for (let now = 33; now < 4000; now += 33) last = estimator.detect(video, now) as PoseDetection[];
      expect(last).toEqual([judge, still]);
    });

    it('steps aside on a camera that follows the athlete: the frame as it is, and everybody, even somebody the travel chose', async () => {
      // A panning camera sweeps the people behind the bed through the picture: their hips "travel" and the travel can
      // choose one of them, while the motion box (the camera's own move taken out imperfectly) sits off the athlete, so the
      // mask would hide them. Measured on the broadcast clip: the mask kept 3 to 12% of the picture, the athlete outside it.
      const body = (x: number, y: number, torso: number): PoseDetection => {
        const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: y - torso / 2, visibility: 1 }));
        landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x, y, visibility: 1 };
        landmarks[LM.L_SHOULDER] = landmarks[LM.R_SHOULDER] = { x, y: y - torso, visibility: 1 };
        return { landmarks };
      };
      const swept = (t: number) => body(0.3, 0.55 - 0.3 * Math.abs(Math.sin((Math.PI * t) / 1.6)), 0.08);
      const athlete = body(0.5, 0.5, 0.1);
      const offAthlete = [{ x0: 80, y0: 5, x1: 95, y1: 30 }];
      let now = 0;
      const { factory, given } = setup(
        [frameWith(0.2, offAthlete, { type: 'tracking', speed: 0.4 })],
        () => [swept(now / 1000), athlete],
        { focus: 'travel' },
      );
      const estimator = await factory(options);
      let last: PoseDetection[] = [];
      for (now = 0; now < 8000; now += 33) last = estimator.detect(video, now) as PoseDetection[];
      // Masked while the follow was not known yet, the frame itself once it is.
      expect(given[0]).toBe(masked);
      expect(given[given.length - 1]).toBe(video);
      expect(last).toHaveLength(2);
    });
  });

  describe('the view of the athlete', () => {
    const where = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];
    const zoomed = { name: 'a zoomed view' } as unknown as HTMLCanvasElement;
    const paint = vi.fn(() => zoomed as unknown as CanvasImageSource);

    it('gives the pose model a zoomed view of the athlete once the shot has been steady a while, and the people it finds are put back in the frame', async () => {
      // The athlete is in the middle of the view the pose model is given: they are where the box of the athlete is.
      const { factory, given } = setup([frameWith(0.2, where)], [person(0.5, 0.5)], { view: { zoom: true }, paint });
      const estimator = await factory(options);
      // The zoom view waits for the shot to have been steady, with a small athlete, for two seconds (`ZoomGate`).
      estimator.detect(video, 0);
      const found = estimator.detect(video, 2500) as PoseDetection[];
      expect(given).toEqual([masked, zoomed]);
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
      await estimator.detect(video, 0);
      const found = await (estimator.detect(video, 2500) as Promise<PoseDetection[]>);
      expect(found[0].landmarks[LM.L_HIP].x).toBeCloseTo(0.505, 6);
    });
  });

  describe('turning the picture upright', () => {
    const turnedCanvas = { name: 'a turned view' } as unknown as HTMLCanvasElement;
    /** A big athlete (the zoom view is not wanted for them) on a steady shot. */
    const big = { athleteShare: 0.6 };

    /**
     * A person whose hips are at (x, y) of the frame (0 to 1) and whose trunk, `torso` of the frame's height long, leans `lean` degrees to
     * the right, as a perfect pose model finds them in `view` (null: in the frame itself).
     */
    function leaning(x: number, y: number, lean: number, torso: number, view: View | null): PoseDetection {
      const { videoWidth: w, videoHeight: h } = video;
      const at = (u: number, v: number) => {
        const p = view ? toView({ x: u * w, y: v * h }, view) : { x: u * w, y: v * h };
        const size = view ?? { width: w, height: h };
        return { x: p.x / size.width, y: p.y / size.height, visibility: 1 };
      };
      const rad = (lean * Math.PI) / 180;
      const landmarks = Array.from({ length: LANDMARK_COUNT }, () => at(x, y));
      landmarks[LM.L_SHOULDER] = landmarks[LM.R_SHOULDER] = at(
        x + (Math.sin(rad) * torso * h) / w,
        y - Math.cos(rad) * torso,
      );
      return { landmarks };
    }

    /** Runs the people of `scene` (given the time, s, and the view the model was given) through the mask, 30 frames a second, and gives the views painted for each frame. */
    async function run(scene: (t: number, view: View | null) => PoseDetection[], says: MotionResult, extra: object) {
      const views: (View | null)[] = [];
      let painted: View | null = null;
      const paint = vi.fn((_source: CanvasImageSource, view: View) => {
        painted = view;
        return turnedCanvas as unknown as CanvasImageSource;
      });
      let now = 0;
      const { factory, given } = setup(
        [says],
        () => {
          const view = given[given.length - 1] === turnedCanvas ? painted : null;
          views.push(view);
          return scene(now / 1000, view);
        },
        { paint, ...extra },
      );
      const estimator = await factory(options);
      for (now = 0; now < 8000; now += 33) estimator.detect(video, now);
      return views;
    }

    /** The share of the last two seconds' frames whose picture was turned. */
    const turnedShare = (views: (View | null)[]) => views.slice(-60).filter((v) => v && v.angle !== 0).length / 60;

    it('turns the whole frame for a somersault of a big athlete, where the zoom view is not used', async () => {
      const where = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];
      const views = await run((t, view) => [leaning(0.5, 0.6, t * 450, 0.15, view)], frameWith(0.2, where, big), {
        view: { zoom: true, rotate: true },
        focus: false,
      });
      expect(turnedShare(views)).toBeGreaterThan(0.5);
      for (const v of views) if (v) expect([v.width, v.height, v.scale]).toEqual([640, 360, 1]);
    });

    it('learns the turn from the person who jumps, not from the spotter in the motion box', async () => {
      const jumper = (t: number, view: View | null) =>
        leaning(0.3, 0.55 - 0.3 * Math.abs(Math.sin((Math.PI * t) / 1.6)), t * 450, 0.08, view);
      const boxOnSpotter = [{ x0: 42, y0: 70, x1: 62, y1: 95 }];
      const views = await run(
        (t, view) => [leaning(0.52, 0.8, 0, 0.2, view), jumper(t, view)],
        frameWith(0.2, boxOnSpotter, big),
        { view: { zoom: true, rotate: true }, focus: 'travel', athletes: 2 },
      );
      expect(turnedShare(views)).toBeGreaterThan(0.5);
      // Turned by about the jumper's own lean, frame by frame.
      for (let i = views.length - 60; i < views.length; i++) {
        const v = views[i];
        if (!v || v.angle === 0) continue;
        const truth = ((i * 33) / 1000) * 450;
        expect(Math.abs(((((v.angle - truth) % 360) + 540) % 360) - 180)).toBeLessThan(25);
      }
    });

    it('leaves the picture as it is once two people jump (synchro): one turn cannot put both upright', async () => {
      const at = (x: number, phase: number) => (t: number, view: View | null) =>
        leaning(x, 0.55 - 0.3 * Math.abs(Math.sin((Math.PI * (t + phase)) / 1.6)), t * 450, 0.08, view);
      const a = at(0.25, 0);
      const b = at(0.7, 0.4);
      const views = await run(
        (t, view) => [a(t, view), b(t, view)],
        frameWith(0.2, [{ x0: 15, y0: 20, x1: 35, y1: 60 }], big),
        {
          view: { zoom: true, rotate: true },
          focus: 'travel',
          athletes: 2,
        },
      );
      expect(turnedShare(views)).toBe(0);
    });

    it('does not turn anything unless asked', async () => {
      const where = [{ x0: 40, y0: 45, x1: 60, y1: 75 }];
      const views = await run((t, view) => [leaning(0.5, 0.6, t * 450, 0.15, view)], frameWith(0.2, where, big), {
        view: { zoom: true },
        focus: false,
      });
      expect(views.every((v) => v === null)).toBe(true);
    });
  });

  it('accepts every engine: they all read the painted canvas (the ONNX ones measure what they are given)', async () => {
    const { factory } = setup([frame(1)]);
    await expect(factory({ ...options, engine: 'rtmpose' })).resolves.toBeDefined();
    await expect(factory({ ...options, engine: 'mediapipe' })).resolves.toBeDefined();
  });

  it('steps aside for a source that is not a video: the pose model gets it as it is', async () => {
    const { factory, given, layer } = setup([frame(0.4)]);
    const estimator = await factory(options);
    const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
    expect(estimator.detect(canvas, 1000)).toBe(detections);
    expect(given).toEqual([canvas]);
    expect(layer.process).not.toHaveBeenCalled();
  });
});

describe('the follow clip', () => {
  const fast = { ...frameWith(0.2, [{ x0: 40, y0: 45, x1: 60, y1: 75 }], { type: 'tracking', speed: 0.4 }) };
  const still = frameWith(0.2, [{ x0: 40, y0: 45, x1: 60, y1: 75 }]);

  it('is known once the camera has moved fast for a second without a pause, and for good', () => {
    const watch = new FollowWatch();
    let known = false;
    for (let t = 0; t <= 1000; t += 40) known = watch.push(fast, t);
    expect(known).toBe(true);
    expect(watch.push(still, 1040)).toBe(true);
  });

  it('is not known from two fast stretches of the clip with a seek between them', () => {
    const watch = new FollowWatch();
    for (let t = 0; t <= 600; t += 40) watch.push(fast, t);
    expect(watch.push(fast, 60_000)).toBe(false);
    expect(watch.push(fast, 60_040)).toBe(false);
  });
});
