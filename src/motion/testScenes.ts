import type { GrayFrame } from './types';

/**
 * Test-only synthetic gym scenes with known ground truth: a wall with texture, a trampoline bed, people who jump, walk, wave or
 * just stand, and the defects of a real video (noise, a light that flickers, a camera that shakes). The people are drawn
 * with soft edges from circles and capsules, like the test mannequins of the other stages.
 */

export interface JumperSpec {
  /** Where the athlete bounces, picture pixels: the x of the body, and the y of the bed (where the feet land). */
  x: number;
  bedY: number;
  /** Body height, picture pixels. */
  size: number;
  /** Time of one jump, seconds. */
  periodS: number;
  /** How high the feet get above the bed at the top of a full jump, picture pixels. */
  apex: number;
  /** The athlete stands still until this time, then bounces higher and higher over `rampJumps` jumps. */
  startS: number;
  rampJumps?: number;
  /** The athlete turns a somersault in every Nth jump (0 or missing: never). */
  somersaultEvery?: number;
  /** The athlete stops jumping at this time and stands on the bed. */
  stopS?: number;
}

export interface WalkerSpec {
  /** The y of the feet, picture pixels. */
  y: number;
  size: number;
  /** Walks between these x, picture pixels, back and forth at `speed` pixels a second. */
  from: number;
  to: number;
  speed: number;
}

export interface WaverSpec {
  x: number;
  y: number;
  /** Size of the blob, picture pixels, how far it moves up and down, and how fast. */
  size: number;
  amplitude: number;
  hz: number;
}

export interface StanderSpec {
  x: number;
  /** The y of the feet. */
  y: number;
  size: number;
}

export interface SceneSpec {
  width: number;
  height: number;
  fps: number;
  seconds: number;
  jumpers: JumperSpec[];
  walkers?: WalkerSpec[];
  wavers?: WaverSpec[];
  standers?: StanderSpec[];
  /** Standard deviation of the noise added to every pixel of every frame, intensity 0..1. */
  noise?: number;
  /** Amplitude of the brightness change of the whole picture from frame to frame (a light that flickers). */
  flicker?: number;
  /** Amplitude of the vertical shake of the whole picture, picture pixels (a camera in the hand). */
  jitter?: number;
  /** How much texture the wall has, 0 (a plain wall) to 1 (the default). */
  texture?: number;
  seed?: number;
}

export interface Scene {
  frames: GrayFrame[];
  timesMs: number[];
  /** Per frame, 1 where a jumper is (the truth the mask is checked against). */
  jumperPixels: Uint8Array[];
}

// --- Pictures ----------------------------------------------------------------------------------------------------

/** A small deterministic random generator (mulberry32), so a scene is the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rand: () => number): number =>
  Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());

interface Disc {
  kind: 'disc';
  x: number;
  y: number;
  r: number;
  value: number;
}
interface Capsule {
  kind: 'capsule';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  value: number;
}
type Shape = Disc | Capsule;

/** How much of the pixel at (x, y) the shape covers, 0 to 1 (a soft edge one pixel wide). */
function coverage(shape: Shape, x: number, y: number): number {
  let distance: number;
  if (shape.kind === 'disc') {
    distance = Math.hypot(x - shape.x, y - shape.y) - shape.r;
  } else {
    const dx = shape.x1 - shape.x0;
    const dy = shape.y1 - shape.y0;
    const t = Math.max(0, Math.min(1, ((x - shape.x0) * dx + (y - shape.y0) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.hypot(x - (shape.x0 + t * dx), y - (shape.y0 + t * dy)) - shape.r;
  }
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function boundsOf(shape: Shape): [number, number, number, number] {
  return shape.kind === 'disc'
    ? [shape.x - shape.r, shape.y - shape.r, shape.x + shape.r, shape.y + shape.r]
    : [
        Math.min(shape.x0, shape.x1) - shape.r,
        Math.min(shape.y0, shape.y1) - shape.r,
        Math.max(shape.x0, shape.x1) + shape.r,
        Math.max(shape.y0, shape.y1) + shape.r,
      ];
}

interface Pose {
  /** Where the hips are, picture pixels, and the body turned by this angle (radians, clockwise) around them. */
  hipX: number;
  hipY: number;
  angle: number;
  /** The arms and legs swing by up to this angle (radians) around straight down, at this phase. */
  swing: number;
  phase: number;
}

/** A person of height `size`: dark shirt and shorts, lighter head and limbs. The arms and legs swing; the body can turn around the hips. */
function person(size: number, pose: Pose): Shape[] {
  const { hipX, hipY, angle, swing, phase } = pose;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // A point given relative to the hips with y pointing down, moved to the picture.
  const at = (x: number, y: number): [number, number] => [
    hipX + (x * cos - y * sin) * size,
    hipY + (x * sin + y * cos) * size,
  ];
  const limb = (
    shoulderX: number,
    shoulderY: number,
    length: number,
    theta: number,
    r: number,
    value: number,
  ): Capsule => {
    const [x0, y0] = at(shoulderX, shoulderY);
    const [x1, y1] = at(shoulderX + Math.sin(theta) * length, shoulderY + Math.cos(theta) * length);
    return { kind: 'capsule', x0, y0, x1, y1, r: r * size, value };
  };
  const [tx, ty] = at(0, -0.28);
  const [hx, hy] = at(0, -0.37);
  const [bx, by] = at(0, 0);
  const s = Math.sin(phase) * swing;
  return [
    { kind: 'capsule', x0: bx, y0: by, x1: tx, y1: ty, r: 0.11 * size, value: 0.1 },
    { kind: 'disc', x: hx, y: hy, r: 0.07 * size, value: 0.4 },
    limb(-0.03, 0, 0.5, -0.05 + s, 0.07, 0.12),
    limb(0.03, 0, 0.5, 0.05 - s, 0.07, 0.12),
    limb(-0.1, -0.26, 0.33, 0.1 - s, 0.045, 0.45),
    limb(0.1, -0.26, 0.33, -0.1 + s, 0.045, 0.45),
  ];
}

/** Where the jumper is at time `t`: the feet above the bed (picture pixels), and the share of the flight gone (0 on the bed). */
function flightAt(j: JumperSpec, t: number): { lift: number; jump: number; share: number } {
  if (t < j.startS || (j.stopS !== undefined && t >= j.stopS)) return { lift: 0, jump: -1, share: 0 };
  const since = t - j.startS;
  const jump = Math.floor(since / j.periodS);
  const share = since / j.periodS - jump;
  const ramp = Math.min(1, 0.2 + (0.8 * (jump + 1)) / (j.rampJumps ?? 3));
  return { lift: 4 * j.apex * ramp * share * (1 - share), jump, share };
}

/** The wall, the bed and the things around it that never move. Rows are indexed by y; the scene shakes by sampling between two rows. */
function backdrop(spec: SceneSpec, rand: () => number): Float32Array {
  const { width: w, height: h } = spec;
  const texture = spec.texture ?? 1;
  const bed = spec.jumpers.length ? Math.max(...spec.jumpers.map((j) => j.bedY)) : h * 0.85;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const grain = 0.03 * Math.sin(0.55 * x + 0.31 * y) * Math.sin(0.43 * y - 0.2 * x) + 0.03 * rand();
      let v = 0.62 + 0.1 * (y / h - 0.5) + texture * grain;
      if (y > bed + 1 && x > 0.2 * w && x < 0.8 * w) v = 0.22 + 0.04 * rand() + (y % 14 === 0 ? 0.12 : 0);
      if (texture > 0 && x >= 0.12 * w && x < 0.12 * w + 2) v = 0.85;
      if (texture > 0 && y >= 0.22 * h && y < 0.22 * h + 2) v = 0.3;
      out[y * w + x] = v;
    }
  }
  return out;
}

/** One frame of a scene: the picture, its time, and the pixels where a jumper is. */
export interface SceneFrame {
  frame: GrayFrame;
  timeMs: number;
  jumperPixels: Uint8Array;
}

/** The frames of a scene one at a time, for scenes too big to keep in memory (a test video). */
export function* sceneFrames(spec: SceneSpec): Generator<SceneFrame> {
  const { width: w, height: h, fps, seconds } = spec;
  const rand = random(spec.seed ?? 1);
  const wall = backdrop(spec, rand);
  const count = Math.round(seconds * fps);

  for (let f = 0; f < count; f++) {
    const t = f / fps;
    const shake = spec.jitter ? (rand() * 2 - 1) * spec.jitter : 0;
    const data = new Float32Array(w * h);
    // The wall, shifted by the shake (linear between two rows).
    const row0 = Math.floor(-shake);
    const frac = -shake - row0;
    for (let y = 0; y < h; y++) {
      const a = Math.min(h - 1, Math.max(0, y + row0)) * w;
      const b = Math.min(h - 1, Math.max(0, y + row0 + 1)) * w;
      for (let x = 0; x < w; x++) data[y * w + x] = wall[a + x] * (1 - frac) + wall[b + x] * frac;
    }

    const truth = new Uint8Array(w * h);
    const draw = (shapes: Shape[], isJumper: boolean) => {
      for (const shape of shapes) {
        const [x0, y0, x1, y1] = boundsOf(shape);
        for (let y = Math.max(0, Math.floor(y0 + shake) - 1); y <= Math.min(h - 1, Math.ceil(y1 + shake) + 1); y++) {
          for (let x = Math.max(0, Math.floor(x0) - 1); x <= Math.min(w - 1, Math.ceil(x1) + 1); x++) {
            const c = coverage(shape, x, y - shake);
            if (c <= 0) continue;
            data[y * w + x] += (shape.value - data[y * w + x]) * c;
            if (isJumper && c >= 0.5) truth[y * w + x] = 1;
          }
        }
      }
    };

    for (const s of spec.standers ?? [])
      draw(person(s.size, { hipX: s.x, hipY: s.y - 0.5 * s.size, angle: 0, swing: 0, phase: 0 }), false);
    for (const k of spec.walkers ?? []) {
      const span = Math.abs(k.to - k.from) || 1;
      const along = (t * k.speed) % (2 * span);
      const x = Math.min(k.from, k.to) + (along < span ? along : 2 * span - along);
      const step = t * 2 * Math.PI * 2;
      draw(
        person(k.size, {
          hipX: x,
          hipY: k.y - 0.5 * k.size + 0.01 * k.size * Math.sin(2 * step),
          angle: 0,
          swing: 0.45,
          phase: step,
        }),
        false,
      );
    }
    for (const v of spec.wavers ?? []) {
      draw(
        [{ kind: 'disc', x: v.x, y: v.y + v.amplitude * Math.sin(2 * Math.PI * v.hz * t), r: v.size / 2, value: 0.15 }],
        false,
      );
    }
    for (const j of spec.jumpers) {
      const { lift, jump, share } = flightAt(j, t);
      const turning = j.somersaultEvery && jump >= 0 && (jump + 1) % j.somersaultEvery === 0 && lift > 0;
      draw(
        person(j.size, {
          hipX: j.x,
          hipY: j.bedY - lift - 0.5 * j.size,
          angle: turning ? 2 * Math.PI * share : 0,
          swing: lift > 0 ? 0.5 : 0,
          phase: t * 2 * Math.PI * (1 / j.periodS) * 2,
        }),
        true,
      );
    }

    const flicker = spec.flicker ? (rand() * 2 - 1) * spec.flicker : 0;
    const noise = spec.noise ?? 0;
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.min(1, Math.max(0, data[i] + flicker + (noise ? noise * gaussian(rand) : 0)));
    }
    yield { frame: { width: w, height: h, data }, timeMs: Math.round(t * 1000), jumperPixels: truth };
  }
}

/** All the frames of a scene. */
export function renderScene(spec: SceneSpec): Scene {
  const scene: Scene = { frames: [], timesMs: [], jumperPixels: [] };
  for (const { frame, timeMs, jumperPixels } of sceneFrames(spec)) {
    scene.frames.push(frame);
    scene.timesMs.push(timeMs);
    scene.jumperPixels.push(jumperPixels);
  }
  return scene;
}

/** A gym with one athlete on the bed, the usual test: bounces from 1 s, 25% of the picture high at the top of a full jump. */
export const ONE_ATHLETE: SceneSpec = {
  width: 128,
  height: 72,
  fps: 30,
  seconds: 14,
  jumpers: [{ x: 64, bedY: 60, size: 22, periodS: 1.1, apex: 24, startS: 1 }],
  noise: 0.006,
  flicker: 0.004,
  seed: 7,
};
