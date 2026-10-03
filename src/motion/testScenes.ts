import { blur121 } from './grid';
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

/** What the camera does. The scene is bigger than the picture, and the picture is a window that moves over it. */
export type CameraSpec =
  /** Pans at a constant speed, picture pixels a second (right and down are positive). */
  | { kind: 'pan'; vx: number; vy?: number }
  /** Pans back and forth, a sine of this amplitude (picture pixels) and period, so the athlete stays in the picture. */
  | { kind: 'sway'; ax: number; ay?: number; periodS: number }
  /**
   * Tilts to follow the first jumper: the camera moves up with the athlete by `gain` of their height above the bed (1 keeps the athlete at
   * the same height in the picture), a little late (`lagS`, seconds).
   */
  | { kind: 'follow'; gain: number; lagS?: number };

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
  /** A camera that moves (missing: it stands still, apart from `jitter`). */
  camera?: CameraSpec;
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

/**
 * The wall, the bed and the things around it that never move, `pad` pixels bigger than the picture on every side (for a camera that
 * moves). Rows are indexed by y + pad, columns by x + pad; the scene is sampled between rows and columns.
 */
function backdrop(spec: SceneSpec, rand: () => number, pad: number): Float32Array {
  const { width: w, height: h } = spec;
  const texture = spec.texture ?? 1;
  const bed = spec.jumpers.length ? Math.max(...spec.jumpers.map((j) => j.bedY)) : h * 0.85;
  const big = w + 2 * pad;
  const out = new Float32Array(big * (h + 2 * pad));
  for (let row = 0; row < h + 2 * pad; row++) {
    const y = row - pad;
    for (let col = 0; col < big; col++) {
      const x = col - pad;
      const grain = 0.03 * Math.sin(0.55 * x + 0.31 * y) * Math.sin(0.43 * y - 0.2 * x) + 0.03 * rand();
      let v = 0.62 + 0.1 * (y / h - 0.5) + texture * grain;
      if (y > bed + 1 && x > 0.2 * w && x < 0.8 * w) v = 0.22 + 0.04 * rand() + (y % 14 === 0 ? 0.12 : 0);
      if (texture > 0 && x >= 0.12 * w && x < 0.12 * w + 2) v = 0.85;
      if (texture > 0 && y >= 0.22 * h && y < 0.22 * h + 2) v = 0.3;
      out[row * big + col] = v;
    }
  }
  // A scene that is looked at from moving places is sampled between its pixels: its texture is smoothed first, so that the picture does
  // not get sharper and blurrier with where the camera happens to be in between two pixels.
  if (pad > 0) {
    const soft = new Float32Array(out.length);
    blur121(out, soft, big, h + 2 * pad, new Float32Array(out.length));
    return soft;
  }
  return out;
}

/** Where the camera is at every frame: how far the picture's top left corner is from the scene's, picture pixels. */
function cameraPath(spec: SceneSpec): { x: number; y: number }[] {
  const count = Math.round(spec.seconds * spec.fps);
  const camera = spec.camera;
  const path: { x: number; y: number }[] = [];
  let followed = 0;
  for (let f = 0; f < count; f++) {
    const t = f / spec.fps;
    if (!camera) path.push({ x: 0, y: 0 });
    else if (camera.kind === 'pan') path.push({ x: camera.vx * t, y: (camera.vy ?? 0) * t });
    else if (camera.kind === 'sway') {
      const phase = Math.sin((2 * Math.PI * t) / camera.periodS);
      path.push({ x: camera.ax * phase, y: (camera.ay ?? 0) * phase });
    } else {
      const wanted = -camera.gain * flightAt(spec.jumpers[0], t).lift;
      const lag = camera.lagS ?? 0.1;
      followed += (wanted - followed) * (lag > 0 ? 1 - Math.exp(-1 / (spec.fps * lag)) : 1);
      path.push({ x: 0, y: followed });
    }
  }
  return path;
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
  const path = cameraPath(spec);
  const pad = spec.camera ? Math.ceil(Math.max(...path.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))) + 4 : 0;
  const wall = backdrop(spec, rand, pad);
  const bigW = w + 2 * pad;
  const bigH = h + 2 * pad;
  const count = Math.round(seconds * fps);

  for (let f = 0; f < count; f++) {
    const t = f / fps;
    const shake = spec.jitter ? (rand() * 2 - 1) * spec.jitter : 0;
    // The scene shown at frame (x, y) is the one at (x + viewX, y + viewY): a camera that moves right looks further right, and a camera
    // that shakes down sees the scene higher.
    const viewX = path[f].x;
    const viewY = path[f].y - shake;
    const data = new Float32Array(w * h);
    // The wall, seen from where the camera is (linear between two rows and two columns).
    const col0 = Math.floor(viewX);
    const fracX = viewX - col0;
    const row0 = Math.floor(viewY);
    const fracY = viewY - row0;
    for (let y = 0; y < h; y++) {
      const a = Math.min(bigH - 1, Math.max(0, y + row0 + pad)) * bigW;
      const b = Math.min(bigH - 1, Math.max(0, y + row0 + 1 + pad)) * bigW;
      for (let x = 0; x < w; x++) {
        const c = Math.min(bigW - 1, Math.max(0, x + col0 + pad));
        const d = Math.min(bigW - 1, Math.max(0, x + col0 + 1 + pad));
        data[y * w + x] =
          (wall[a + c] * (1 - fracX) + wall[a + d] * fracX) * (1 - fracY) +
          (wall[b + c] * (1 - fracX) + wall[b + d] * fracX) * fracY;
      }
    }

    const truth = new Uint8Array(w * h);
    const draw = (shapes: Shape[], isJumper: boolean) => {
      for (const shape of shapes) {
        const [x0, y0, x1, y1] = boundsOf(shape);
        for (let y = Math.max(0, Math.floor(y0 - viewY) - 1); y <= Math.min(h - 1, Math.ceil(y1 - viewY) + 1); y++) {
          for (let x = Math.max(0, Math.floor(x0 - viewX) - 1); x <= Math.min(w - 1, Math.ceil(x1 - viewX) + 1); x++) {
            const c = coverage(shape, x + viewX, y + viewY);
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
