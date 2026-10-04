import { describe, expect, it } from 'vitest';
import { TrampolineMotionDetector } from './detector';
import { DEFAULT_MOTION_CONFIG, type MotionConfig } from './config';
import { AthleteScout } from './scout';
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
  /** Pixels that crossed 0.5 and came back the frame after: a mask that follows an athlete moves its edge by, and never blinks. */
  blinks: number[];
  /** Per person who stands (`standers`, in the order of the scene): the share of their body that the mask keeps, per frame. */
  standerKept: number[][];
  /** How many athletes the detector reported, per frame. */
  athletes: number[];
  /** The middle of the box of the first athlete, per frame; NaN where there is none. */
  centerX: number[];
  period: (number | null)[];
  /** The kind of shot the detector was working with, per frame. */
  shot: string[];
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
    blinks: [],
    standerKept: (spec.standers ?? []).map(() => []),
    athletes: [],
    centerX: [],
    period: [],
    shot: [],
    lastResult: undefined as unknown as MotionResult,
  };
  // The columns far from every athlete: what the mask should hide.
  const farColumns = Array.from({ length: w }, (_, x) =>
    spec.jumpers.every((j) => Math.abs(x - j.x) > 0.3 * Math.min(w, h * 1.5)),
  );
  const farCount = farColumns.filter(Boolean).length * h;
  let before: Float32Array | null = null;
  let beforeThat: Float32Array | null = null;
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
    let blinks = 0;
    if (before) {
      for (let i = 0; i < before.length; i++) {
        change += Math.abs(result.mask[i] - before[i]);
        if (result.mask[i] >= 0.5 !== before[i] >= 0.5) flips++;
        if (beforeThat && before[i] >= 0.5 !== beforeThat[i] >= 0.5 && result.mask[i] >= 0.5 === beforeThat[i] >= 0.5)
          blinks++;
      }
    }
    (spec.standers ?? []).forEach((s, n) => {
      // The body of a person who stands: a box a fifth of their height each side of them, from the feet up.
      const x0 = Math.max(0, Math.round(s.x - 0.2 * s.size));
      const x1 = Math.min(w - 1, Math.round(s.x + 0.2 * s.size));
      const y0 = Math.max(0, Math.round(s.y - s.size));
      const y1 = Math.min(h - 1, Math.round(s.y));
      let visible = 0;
      let all = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          all++;
          if (result.mask[y * w + x] >= 0.5) visible++;
        }
      }
      out.standerKept[n].push(all ? visible / all : NaN);
    });
    out.found.push(result.found);
    out.coverage.push(result.coverage);
    out.athleteKept.push(athlete ? kept / athlete : NaN);
    out.farKept.push(farCount ? farKept / farCount : NaN);
    out.change.push(before ? change / before.length : 0);
    out.flips.push(flips);
    out.blinks.push(blinks);
    out.athletes.push(result.athletes.length);
    out.centerX.push(result.athletes.length ? (result.athletes[0].x0 + result.athletes[0].x1) / 2 : NaN);
    out.period.push(result.periodS);
    out.shot.push(result.camera.type);
    beforeThat = before;
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

  it('follows the athlete without flicker: its edge moves, and no pixel blinks', () => {
    // The mask is the box of what moves, so its edge goes with the athlete and pixels cross it; a pixel that crosses and comes back is flicker.
    // (A few pixels do, in the frame where the athlete turns round at the top or the bottom of a jump.)
    const blinks = between(r, r.blinks, 8).sort((a, b) => a - b);
    expect(mean(blinks)).toBeLessThan(4);
    expect(blinks[Math.floor(blinks.length * 0.95)]).toBeLessThan(20);
  });

  it('reports one athlete, as a box that has the athlete in it', () => {
    expect(new Set(between(r, r.athletes, 8))).toEqual(new Set([1]));
    const [box] = r.lastResult.athletes;
    // The athlete is at x = 64 of 128, and their feet are on the bed at y = 60.
    expect(box.x0).toBeLessThan(64);
    expect(box.x1).toBeGreaterThan(64);
    expect(box.y1).toBeGreaterThanOrEqual(40);
    expect(box.x1 - box.x0).toBeLessThan(40);
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

  const twoTrampolines = clip({
    jumpers: [
      { x: 40, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 1 },
      { x: 90, bedY: 60, size: 22, periodS: 1.1, apex: 22, startS: 1.4 },
    ],
  });

  it('keeps both athletes on two trampolines when it is told there are two (synchro)', () => {
    const two = run('two', twoTrampolines, { maxAthletes: 2 });
    expect(new Set(between(two, two.athletes, 8))).toEqual(new Set([2]));
    expect(mean(between(two, two.athleteKept, 8))).toBeGreaterThan(0.99);
    expect(mean(between(two, two.farKept, 8))).toBeLessThan(0.02);
  });

  it('keeps one person only by default, the one who jumps the most, and hides the other jumper', () => {
    const one = run('two-default', twoTrampolines);
    expect(new Set(between(one, one.athletes, 8))).toEqual(new Set([1]));
    // Half of the pixels of the two jumpers are the one that is kept.
    const kept = mean(between(one, one.athleteKept, 8));
    expect(kept).toBeGreaterThan(0.45);
    expect(kept).toBeLessThan(0.55);
    // And it is the same person all the way: the box does not go from one trampoline to the other.
    const [box] = one.lastResult.athletes;
    expect(box.x1 < 65 || box.x0 > 65).toBe(true);
  });
});

describe('the one person who jumps', () => {
  // The athlete is 22 pixels tall and 8 wide, at x = 64. People who stand are 22 pixels tall too.
  it('hides a person who stands still next to the athlete, a body height away or more', () => {
    const r = run(
      'still-next',
      clip({
        noise: 0.008,
        standers: [
          { x: 64 + 26, y: 64, size: 22 },
          { x: 64 - 30, y: 64, size: 22 },
        ],
      }),
    );
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
    for (const kept of r.standerKept) expect(mean(between(r, kept, 8))).toBeLessThan(0.05);
  });

  it('shows less of a person who stands closer, and none of the athlete is lost for it', () => {
    const r = run('still-close', clip({ standers: [{ x: 64 + 15, y: 64, size: 22 }] }));
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
    // Their body starts 11 pixels from the athlete's centre, and the box of what moves reaches about 10 of them: a part of the edge shows.
    expect(mean(between(r, r.standerKept[0], 8))).toBeLessThan(0.5);
  });

  it('hides a person who only bounces a little while the athlete jumps high', () => {
    const r = run(
      'light-bouncer',
      clip({
        jumpers: [
          { x: 64, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 1 },
          { x: 104, bedY: 60, size: 20, periodS: 0.9, apex: 5, startS: 1.2 },
        ],
      }),
    );
    // The truth of the scene counts both as jumpers: the athlete, who is kept, and the second one, whose pixels are not.
    expect(new Set(between(r, r.athletes, 8))).toEqual(new Set([1]));
    const [box] = r.lastResult.athletes;
    expect(box.x1).toBeLessThan(90);
  });

  it('keeps the same person when two jump about as much, instead of going from one to the other', () => {
    const r = run(
      'rivals',
      clip({
        seconds: 16,
        jumpers: [
          { x: 36, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 1 },
          { x: 92, bedY: 60, size: 22, periodS: 1.15, apex: 23, startS: 1.3 },
        ],
      }),
    );
    expect(new Set(between(r, r.athletes, 6))).toEqual(new Set([1]));
    // Once one is chosen the box stays on that side of the picture in every frame.
    const sides = new Set(between(r, r.centerX, 6).map((x) => (x < 64 ? 'left' : 'right')));
    expect(sides.size).toBe(1);
  });

  it('hides the background gradually: the picture does not jump when the athlete is found', () => {
    const r = run('one', { ...ONE_ATHLETE, seconds: 12 });
    let steepest = 0;
    for (let f = 1; f < r.coverage.length; f++) steepest = Math.max(steepest, r.coverage[f - 1] - r.coverage[f]);
    expect(steepest).toBeLessThan(0.06);
  });
});

describe('a look ahead at the start of the clip', () => {
  // The athlete is found a few seconds in; run once over the clip, the detector says where they jump, and a second run is told before it starts.
  const spec = clip({ noise: 0.008, standers: [{ x: 64 + 28, y: 64, size: 22 }] });
  const scene = renderScene(spec);
  const first = new TrampolineMotionDetector();
  const scout = new AthleteScout();
  for (let f = 0; f < scene.frames.length; f++) {
    if (scout.push(first.push(scene.frames[f], scene.timesMs[f]), scene.timesMs[f] / 1000)) break;
  }
  const place = scout.box();

  it('finds the place the athlete jumps in', () => {
    expect(place).not.toBeNull();
    expect(place!.x0).toBeLessThan(64);
    expect(place!.x1).toBeGreaterThan(64);
    expect(place!.y1).toBeGreaterThan(50);
  });

  it('hides the people around the bed from the very first frame, without losing the athlete', () => {
    const detector = new TrampolineMotionDetector();
    detector.hint(place);
    const kept: number[] = [];
    const still: number[] = [];
    const coverage: number[] = [];
    const frames = Math.round(2.5 * spec.fps);
    for (let f = 0; f < frames; f++) {
      const result = detector.push(scene.frames[f], scene.timesMs[f]);
      expect(result.found).toBe(false);
      let a = 0;
      let k = 0;
      for (let i = 0; i < scene.jumperPixels[f].length; i++) {
        if (!scene.jumperPixels[f][i]) continue;
        a++;
        if (result.mask[i] >= 0.5) k++;
      }
      kept.push(a ? k / a : NaN);
      let seen = 0;
      let all = 0;
      for (let y = 42; y <= 64; y++) {
        for (let x = 85; x <= 99; x++) {
          all++;
          if (result.mask[y * spec.width + x] >= 0.5) seen++;
        }
      }
      still.push(seen / all);
      coverage.push(result.coverage);
    }
    // Before the first jump the athlete stands, and from 1 s they bounce, a little at first.
    expect(Math.min(...kept.filter((v) => !Number.isNaN(v)))).toBeGreaterThan(0.95);
    expect(Math.max(...still)).toBeLessThan(0.05);
    expect(Math.max(...coverage)).toBeLessThan(0.3);
    expect(coverage[0]).toBeLessThan(0.3);
  });

  it('lets the detector take over when it finds the athlete, and shows the picture as it was with no hint', () => {
    const hinted = new TrampolineMotionDetector();
    hinted.hint(place);
    let last = hinted.push(scene.frames[0], scene.timesMs[0]);
    for (let f = 1; f < scene.frames.length; f++) last = hinted.push(scene.frames[f], scene.timesMs[f]);
    expect(last.found).toBe(true);
    expect(last.athletes.length).toBe(1);
    // The same box as without the hint: it is the detector's own now.
    const plain = new TrampolineMotionDetector();
    let same = plain.push(scene.frames[0], scene.timesMs[0]);
    for (let f = 1; f < scene.frames.length; f++) same = plain.push(scene.frames[f], scene.timesMs[f]);
    expect(last.athletes[0]).toEqual(same.athletes[0]);
    // And nothing was hidden without it, in the first frames.
    const early = new TrampolineMotionDetector();
    expect(early.push(scene.frames[0], scene.timesMs[0]).coverage).toBeGreaterThan(0.999);
  });

  it('forgets the hint after a cut in the video', () => {
    const detector = new TrampolineMotionDetector();
    detector.hint(place);
    detector.push(scene.frames[0], scene.timesMs[0]);
    expect(detector.push(scene.frames[1], scene.timesMs[1] + 5000).coverage).toBeGreaterThan(0.999);
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

describe('a camera that moves', () => {
  // A close-up: the camera tilts up and down with the jumps, so the athlete stays about where they are in the picture, and the wall goes by.
  const follow = run('follow', clip({ camera: { kind: 'follow', gain: 0.9 } }));
  // A wide shot where the person who films pans from side to side.
  const sway = run('sway', clip({ camera: { kind: 'sway', ax: 20, periodS: 6 } }));

  it('reads a camera that follows the athlete, or pans, as one that moves, within the first seconds', () => {
    expect(follow.shot.indexOf('tracking') / follow.fps).toBeLessThan(4);
    expect(follow.shot[follow.shot.length - 1]).toBe('tracking');
    expect(sway.shot.indexOf('tracking') / sway.fps).toBeLessThan(4);
    expect(sway.shot[sway.shot.length - 1]).toBe('tracking');
  });

  it('keeps the athlete and hides the wall that goes by, as it does when the camera stands still', () => {
    for (const r of [follow, sway]) {
      expect(r.found.some(Boolean)).toBe(true);
      expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.97);
      expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.06);
    }
  });

  it('would take the wall for the athlete without knowing the camera moves', () => {
    // The same close-up, with the kind of shot forced to a still camera: the wall that goes up and down with the jumps is evidence too.
    const blind = run('follow-blind', clip({ camera: { kind: 'follow', gain: 0.9 } }), { cameraType: 'fixed' });
    expect(mean(between(blind, blind.farKept, 8))).toBeGreaterThan(0.2);
  });

  it('does not take the move of the camera for an athlete', () => {
    const empty = run('sway-empty', clip({ jumpers: [], camera: { kind: 'sway', ax: 20, periodS: 6 } }));
    const walker = run(
      'sway-walker',
      clip({
        jumpers: [],
        walkers: [{ y: 62, size: 22, from: 8, to: 110, speed: 14 }],
        camera: { kind: 'sway', ax: 20, periodS: 6 },
      }),
    );
    for (const r of [empty, walker]) {
      expect(r.found.some(Boolean)).toBe(false);
      expect(Math.min(...r.coverage)).toBeGreaterThan(0.999);
    }
  });

  it('works as well when the kind of shot is forced to tracking on a camera that stands still', () => {
    const r = run('still-tracking', clip({}), { cameraType: 'tracking' });
    expect(r.shot.every((shot) => shot === 'tracking')).toBe(true);
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.99);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.02);
  });

  it('reports how the picture moved, and that the move was told', () => {
    const { camera } = follow.lastResult;
    expect(camera.known).toBe(true);
    expect(camera.speed).toBeGreaterThan(DEFAULT_MOTION_CONFIG.cameraMovingSpeed);
  });
});

describe('the kinds of shot', () => {
  // A low camera at the bed, looking up: the athlete is most of the picture high, and the camera stands still (with a little shake).
  const bigAthlete = [{ x: 64, bedY: 68, size: 60, periodS: 1.1, apex: 8, startS: 1 }];

  it('reads a wide shot with a still camera as fixed', () => {
    const r = run('one', { ...ONE_ATHLETE, seconds: 12 });
    expect(new Set(r.shot).size).toBe(1);
    expect(r.shot[0]).toBe('fixed');
  });

  it('reads the same athlete as the same shot in a video held upright and in one held sideways', () => {
    // An athlete a third of the picture's shorter side tall, then more than half of it, in a landscape picture and in a portrait one.
    const landscape = (size: number) =>
      run(`land-${size}`, clip({ jumpers: [{ x: 64, bedY: 68, size, periodS: 1.1, apex: 28 - size / 2, startS: 1 }] }));
    const portrait = (size: number) =>
      run(
        `port-${size}`,
        clip({
          width: 72,
          height: 128,
          jumpers: [{ x: 36, bedY: 118, size, periodS: 1.1, apex: 50 - size / 2, startS: 1 }],
        }),
      );
    expect(landscape(22).shot.at(-1)).toBe('fixed');
    expect(portrait(22).shot.at(-1)).toBe('fixed');
    expect(landscape(50).shot.at(-1)).toBe('lowAngle');
    expect(portrait(50).shot.at(-1)).toBe('lowAngle');
  });

  it('reads a still camera with an athlete who is most of the picture as low-angle, and keeps them', () => {
    const r = run('low', clip({ jumpers: bigAthlete, jitter: 0.7 }));
    expect(r.shot[r.shot.length - 1]).toBe('lowAngle');
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.97);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.05);
  });

  it('copes with a low-angle camera that shakes more than a still one should, once it is told what it is', () => {
    const r = run('low-shake', clip({ jumpers: bigAthlete, jitter: 1.5 }), { cameraType: 'lowAngle' });
    expect(r.found.slice(-30).every(Boolean)).toBe(true);
    expect(mean(between(r, r.athleteKept, 8))).toBeGreaterThan(0.97);
    expect(mean(between(r, r.farKept, 8))).toBeLessThan(0.05);
  });

  it('uses the kind of shot the person chose, whatever the video looks like', () => {
    for (const shot of ['fixed', 'tracking', 'lowAngle'] as const) {
      const r = run(`forced-${shot}`, clip({ seconds: 4 }), { cameraType: shot });
      expect(new Set(r.shot)).toEqual(new Set([shot]));
    }
  });

  it('shows the thresholds as they were set, and the kind of shot changes only the ones in use', () => {
    const detector = new TrampolineMotionDetector({ minAreaShare: 0.01 });
    const scene = renderScene(clip({ seconds: 2 }));
    scene.frames.forEach((frame, f) => detector.push(frame, scene.timesMs[f]));
    detector.configure({ cameraType: 'lowAngle' });
    scene.frames.forEach((frame, f) => detector.push(frame, scene.timesMs[f] + 3000));
    expect(detector.config.minAreaShare).toBe(0.01);
    expect(detector.config.cameraType).toBe('lowAngle');
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
