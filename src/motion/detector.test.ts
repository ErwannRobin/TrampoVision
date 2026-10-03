import { describe, expect, it } from 'vitest';
import { TrampolineMotionDetector } from './detector';
import type { MotionConfig } from './config';
import { ONE_ATHLETE, renderScene, type SceneSpec } from './testScenes';
import type { MotionResult } from './types';

/** What a run of the detector over a scene looked like, frame by frame. */
interface Run {
  fps: number;
  found: boolean[];
  coverage: number[];
  /** Share of the athletes' pixels that the mask keeps (0.5 or more), per frame; NaN where there is no athlete in the picture. */
  athleteKept: number[];
  /** Share of the pixels far from every athlete that the mask keeps, per frame. */
  farKept: number[];
  /** Mean change of the mask from the frame before, per frame. */
  change: number[];
  /** Pixels that crossed 0.5 since the frame before, per frame. */
  flips: number[];
  period: (number | null)[];
  lastResult: MotionResult;
}

const cache = new Map<string, Run>();

/** Runs a detector over a scene and measures the mask against the truth of the scene. Scenes are cached: they are the slow part. */
function run(name: string, spec: SceneSpec, config?: Partial<MotionConfig>): Run {
  const key = name + JSON.stringify(config ?? {});
  const cached = cache.get(key);
  if (cached) return cached;
  const scene = renderScene(spec);
  const detector = new TrampolineMotionDetector(config);
  const { width: w, height: h } = spec;
  const out: Run = {
    fps: spec.fps,
    found: [],
    coverage: [],
    athleteKept: [],
    farKept: [],
    change: [],
    flips: [],
    period: [],
    lastResult: undefined as unknown as MotionResult,
  };
  // The columns far from every athlete: what the mask should hide.
  const farColumns = Array.from({ length: w }, (_, x) =>
    spec.jumpers.every((j) => Math.abs(x - j.x) > 0.3 * Math.min(w, h * 1.5)),
  );
  const farCount = farColumns.filter(Boolean).length * h;
  let before: Float32Array | null = null;
  scene.frames.forEach((frame, f) => {
    const result = detector.push(frame, scene.timesMs[f]);
    const truth = scene.jumperPixels[f];
    let athlete = 0;
    let kept = 0;
    for (let i = 0; i < truth.length; i++) {
      if (!truth[i]) continue;
      athlete++;
      if (result.mask[i] >= 0.5) kept++;
    }
    let farKept = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (farColumns[x] && result.mask[y * w + x] >= 0.5) farKept++;
    }
    let change = 0;
    let flips = 0;
    if (before) {
      for (let i = 0; i < before.length; i++) {
        change += Math.abs(result.mask[i] - before[i]);
        if (result.mask[i] >= 0.5 !== before[i] >= 0.5) flips++;
      }
    }
    out.found.push(result.found);
    out.coverage.push(result.coverage);
    out.athleteKept.push(athlete ? kept / athlete : NaN);
    out.farKept.push(farCount ? farKept / farCount : NaN);
    out.change.push(before ? change / before.length : 0);
    out.flips.push(flips);
    out.period.push(result.periodS);
    before = Float32Array.from(result.mask);
    out.lastResult = result;
  });
  cache.set(key, out);
  return out;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
/** The values of a series from second `from` to second `to` (the end of the run when missing). */
const between = (r: Run, series: number[], from: number, to = Infinity) =>
  series.filter((_, f) => f / r.fps >= from && f / r.fps < to && !Number.isNaN(series[f]));

const clip = (spec: Partial<SceneSpec>): SceneSpec => ({ ...ONE_ATHLETE, seconds: 12, ...spec });

describe('finding one athlete on a trampoline', () => {
  const r = run('one', { ...ONE_ATHLETE, seconds: 12 });

  it('finds them a few jumps after they start, and not before', () => {
    const firstFound = r.found.indexOf(true) / r.fps;
    // They start jumping at 1 s; it takes two and a half jumps to know it is a rhythm.
    expect(firstFound).toBeGreaterThan(2);
    expect(firstFound).toBeLessThan(5);
  });

  it('shows the whole picture while it is not sure', () => {
    const before = r.found.indexOf(true);
    for (let f = 0; f < before; f++) expect(r.coverage[f]).toBeGreaterThan(0.999);
  });

  it('keeps the athlete in the mask in every frame, at every height of the jump', () => {
    const kept = between(r, r.athleteKept, 8);
    expect(mean(kept)).toBeGreaterThan(0.99);
    expect(Math.min(...kept)).toBeGreaterThan(0.9);
  });

  it('hides the rest of the picture', () => {
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.02);
    expect(mean(between(r, r.coverage, 8))).toBeLessThan(0.45);
  });

  it('reads the jump period', () => {
    const periods = between(r, r.period as number[], 8).filter((p) => p !== null);
    expect(mean(periods)).toBeGreaterThan(1.0);
    expect(mean(periods)).toBeLessThan(1.2);
  });

  it('does not flicker once it has settled', () => {
    expect(mean(between(r, r.change, 8))).toBeLessThan(0.0002);
    expect(Math.max(...between(r, r.flips, 8))).toBeLessThan(25);
    expect(mean(between(r, r.flips, 8))).toBeLessThan(2);
  });

  it('gives masks and maps in range', () => {
    const { mask, motion, evidence, rhythm } = r.lastResult;
    expect(Math.min(...mask)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...mask)).toBeLessThanOrEqual(1);
    expect(Math.min(...motion)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...motion)).toBeLessThanOrEqual(1);
    expect(Math.min(...evidence)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...evidence)).toBeLessThanOrEqual(1);
    expect(Math.max(...rhythm)).toBeLessThanOrEqual(1);
  });
});

describe('what it must not take for an athlete', () => {
  it('leaves the picture alone when nobody moves', () => {
    const r = run('still', clip({ jumpers: [], seconds: 6, standers: [{ x: 64, y: 62, size: 22 }], noise: 0.01 }));
    expect(r.found.some(Boolean)).toBe(false);
    expect(Math.min(...r.coverage)).toBeGreaterThan(0.999);
  });

  it('is not fooled by a person who paces to and fro', () => {
    const r = run(
      'walker',
      clip({ jumpers: [], walkers: [{ y: 62, size: 22, from: 8, to: 110, speed: 14 }], noise: 0.008 }),
    );
    expect(r.found.some(Boolean)).toBe(false);
    expect(Math.min(...r.coverage)).toBeGreaterThan(0.999);
  });
});

describe('an athlete among other people', () => {
  // A gym: someone walks at the side, someone waves a hand, two people stand by, the camera shakes a little, the video is noisy.
  const busy = clip({
    noise: 0.01,
    jitter: 0.4,
    walkers: [{ y: 62, size: 22, from: 8, to: 34, speed: 9 }],
    wavers: [{ x: 108, y: 40, size: 4, amplitude: 2.5, hz: 2 }],
    standers: [
      { x: 96, y: 64, size: 22 },
      { x: 22, y: 64, size: 20 },
    ],
  });
  const r = run('busy', busy);

  it('keeps the athlete and hides the people who walk, wave or stand', () => {
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.02);
  });

  it('keeps both athletes on two trampolines', () => {
    const two = run(
      'two',
      clip({
        jumpers: [
          { x: 40, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 1 },
          { x: 90, bedY: 60, size: 22, periodS: 1.1, apex: 22, startS: 1.4 },
        ],
      }),
    );
    expect(mean(between(two, two.athleteKept, 8))).toBeGreaterThan(0.99);
    expect(mean(between(two, two.farKept, 8))).toBeLessThan(0.02);
  });
});

describe('what the athlete does', () => {
  it('keeps an athlete who turns somersaults, whose arms and legs sweep around', () => {
    const r = run(
      'somersaults',
      clip({ jumpers: [{ x: 64, bedY: 60, size: 22, periodS: 1.2, apex: 26, startS: 1, somersaultEvery: 2 }] }),
    );
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.97);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.02);
  });

  it('keeps an athlete who jumps high and slowly (2.2 s a jump)', () => {
    const r = run(
      'high',
      clip({ seconds: 14, jumpers: [{ x: 64, bedY: 62, size: 20, periodS: 2.2, apex: 44, startS: 1, rampJumps: 2 }] }),
    );
    expect(r.found.some(Boolean)).toBe(true);
    expect(mean(between(r, r.athleteKept, 9))).toBeGreaterThan(0.97);
    expect(mean(between(r, r.farKept, 9))).toBeLessThan(0.02);
  });

  it('opens the picture again after the athlete stops jumping', () => {
    const r = run(
      'stops',
      clip({ seconds: 13, jumpers: [{ x: 64, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 0.5, stopS: 5.5 }] }),
    );
    // The athlete still stands on the bed for a while, kept; then the memory of the jumps fades and nothing is hidden.
    expect(r.found[Math.round(5.5 * r.fps)]).toBe(true);
    expect(r.found[r.found.length - 1]).toBe(false);
    expect(r.coverage[r.coverage.length - 1]).toBeGreaterThan(0.99);
  });
});

describe('the video', () => {
  it('copes with a camera that shakes', () => {
    const r = run('shake', clip({ jitter: 0.8, noise: 0.01 }));
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.97);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.05);
  });

  it('copes with a portrait video', () => {
    const r = run(
      'portrait',
      clip({ width: 72, height: 128, jumpers: [{ x: 36, bedY: 108, size: 40, periodS: 1.1, apex: 40, startS: 1 }] }),
    );
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
  });

  it('copes with an athlete who fills the picture, on a plain wall', () => {
    const r = run(
      'close',
      clip({ texture: 0, noise: 0.004, jumpers: [{ x: 64, bedY: 70, size: 50, periodS: 1.1, apex: 14, startS: 1 }] }),
    );
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
  });
});

describe('the detector', () => {
  // Short: it is the length of the video that costs time, and six seconds is enough for the mask to close around the athlete.
  const scene = renderScene(clip({ seconds: 6 }));

  it('starts again after a cut in the video: what it learned does not apply to what comes next', () => {
    const detector = new TrampolineMotionDetector();
    let last = detector.push(scene.frames[0], scene.timesMs[0]);
    for (let f = 1; f < scene.frames.length; f++) last = detector.push(scene.frames[f], scene.timesMs[f]);
    expect(last.found).toBe(true);
    expect(last.coverage).toBeLessThan(0.5);
    // The next frame is two seconds later: a seek.
    const cut = detector.push(scene.frames[scene.frames.length - 1], scene.timesMs[scene.frames.length - 1] + 2000);
    expect(cut.found).toBe(false);
    expect(cut.coverage).toBeGreaterThan(0.999);
  });

  it('copes with a change of picture size', () => {
    const detector = new TrampolineMotionDetector();
    for (let f = 0; f < 5; f++) detector.push(scene.frames[f], scene.timesMs[f]);
    const small = renderScene(
      clip({
        width: 96,
        height: 54,
        seconds: 1,
        jumpers: [{ x: 48, bedY: 45, size: 16, periodS: 1.1, apex: 18, startS: 0 }],
      }),
    );
    const result = detector.push(small.frames[0], 10_000);
    expect(result.width).toBe(96);
    expect(result.mask.length).toBe(96 * 54);
    expect(result.coverage).toBeGreaterThan(0.999);
  });

  it('gives the same masks for the same video', () => {
    const a = new TrampolineMotionDetector();
    const b = new TrampolineMotionDetector();
    let sumA = 0;
    let sumB = 0;
    scene.frames.forEach((frame, f) => {
      const ra = a.push(frame, scene.timesMs[f]);
      const rb = b.push(frame, scene.timesMs[f]);
      sumA += ra.mask.reduce((s, v, i) => s + v * (i % 7), 0);
      sumB += rb.mask.reduce((s, v, i) => s + v * (i % 7), 0);
    });
    expect(sumA).toBe(sumB);
  });

  it('follows a threshold changed while it runs', () => {
    const coverageWith = (marginShare: number) => {
      const detector = new TrampolineMotionDetector();
      detector.configure({ marginShare });
      let last = detector.push(scene.frames[0], scene.timesMs[0]);
      for (let f = 1; f < scene.frames.length; f++) last = detector.push(scene.frames[f], scene.timesMs[f]);
      return last.coverage;
    };
    expect(coverageWith(0.2)).toBeGreaterThan(coverageWith(0.1) + 0.05);
  });

  it('reset shows the whole picture again', () => {
    const detector = new TrampolineMotionDetector();
    scene.frames.forEach((frame, f) => detector.push(frame, scene.timesMs[f]));
    detector.reset();
    const next = detector.push(scene.frames[0], 0);
    expect(next.found).toBe(false);
    expect(next.coverage).toBe(1);
  });
});
