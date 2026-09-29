import type { Keypoint } from '../pose/types';
import { rotateAbout, standingPose } from './testPose';
import type { PoseTrack } from './types';

/** Test helpers: synthetic trampoline routines with analytic ground truth. Not used by the app. */

export const G = 9.81;

export interface JumpSpec {
  /** Vertical launch speed of the center of mass, m/s (flight time = 2 v0 / g). */
  v0: number;
  /** Somersault turns in flight (clockwise on screen when positive). */
  turns?: number;
  /** Horizontal drift of the athlete during the flight, meters (+ = right in the image). */
  driftM?: number;
}

export interface RoutineOptions {
  fps?: number;
  pxPerM?: number;
  athleteHeightM?: number;
  jumps: JumpSpec[];
  /** Standing still at the start, seconds. */
  leadInS?: number;
  /** Duration of each bed contact between two jumps, seconds. */
  contactS?: number;
  /** Rest after the last landing, seconds. */
  tailS?: number;
  /** Athlete x position at the start, px. */
  startX?: number;
  /** Image y of the bed surface (feet at rest), px. */
  bedY?: number;
}

export interface RoutineTruth {
  /** Times in seconds of each jump's events. */
  takeoff: number[];
  apex: number[];
  landing: number[];
  flight: number[];
  /** Apex height above the take-off height, m. */
  rise: number[];
  turns: number[];
  /** Pelvis height above its standing level, m, per frame. */
  hipHeightM: Float64Array;
  /** Cumulative body rotation, degrees, per frame. */
  angleDeg: Float64Array;
  /** Pelvis x, px, per frame. */
  hipX: Float64Array;
}

/**
 * Builds a PoseTrack for a sequence of jumps. Flight is ballistic (a = -g). Contact phases use
 * constant-acceleration parabolas so the velocity is continuous at landing and take-off, which makes
 * the COM dip below the standing level like a real bed does.
 */
export function syntheticRoutine(o: RoutineOptions): { track: PoseTrack; truth: RoutineTruth } {
  const fps = o.fps ?? 30;
  const pxPerM = o.pxPerM ?? 100;
  const heightM = o.athleteHeightM ?? 1.75;
  const H = heightM * pxPerM;
  const leadIn = o.leadInS ?? 0.4;
  const contact = o.contactS ?? 0.35;
  const tail = o.tailS ?? 0.4;
  const x0 = o.startX ?? 320;
  const bedY = o.bedY ?? 600;

  // Piecewise description: [t0, t1, height(τ), angle(τ), x(τ)] in seconds.
  type Piece = { t0: number; t1: number; h: (tau: number) => number; a: (tau: number) => number; x: (tau: number) => number };
  const pieces: Piece[] = [];
  const truth: RoutineTruth = {
    takeoff: [], apex: [], landing: [], flight: [], rise: [], turns: [],
    hipHeightM: new Float64Array(0), angleDeg: new Float64Array(0), hipX: new Float64Array(0),
  };
  let t = 0;
  let angle = 0;
  let x = x0;

  pieces.push({ t0: t, t1: t + leadIn, h: () => 0, a: () => 0, x: () => x0 });
  t += leadIn;

  o.jumps.forEach((jump, k) => {
    const v0 = jump.v0;
    const turns = jump.turns ?? 0;
    const drift = (jump.driftM ?? 0) * pxPerM;
    const flight = (2 * v0) / G;
    const vPrev = k === 0 ? 0 : o.jumps[k - 1].v0;

    // Push-off contact: from rest (first jump) or from the previous landing speed, up to v0.
    const a0 = angle;
    const xa = x;
    if (k === 0) {
      // h'(0) = 0, h(T) = 0, h'(T) = v0  ->  h = v0 τ² (τ - T) / T²
      pieces.push({ t0: t, t1: t + contact, h: (tau) => (v0 * tau * tau * (tau - contact)) / (contact * contact), a: () => a0, x: () => xa });
    } else {
      // h'(0) = -vPrev, h(T) = 0, h'(T) = v0: a cubic h = b τ + c τ² + d τ³ with h(T) = 0.
      const T = contact;
      const A = [[T * T, T * T * T], [2 * T, 3 * T * T]];
      const rhs = [vPrev * T, v0 + vPrev];
      const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
      const c = (rhs[0] * A[1][1] - A[0][1] * rhs[1]) / det;
      const d = (A[0][0] * rhs[1] - rhs[0] * A[1][0]) / det;
      pieces.push({ t0: t, t1: t + T, h: (tau) => -vPrev * tau + c * tau * tau + d * tau ** 3, a: () => a0, x: () => xa });
    }
    t += contact;
    truth.takeoff.push(t);
    truth.apex.push(t + flight / 2);
    truth.landing.push(t + flight);
    truth.flight.push(flight);
    truth.rise.push((v0 * v0) / (2 * G));
    truth.turns.push(turns);
    const xt = x;
    pieces.push({
      t0: t,
      t1: t + flight,
      h: (tau) => v0 * tau - 0.5 * G * tau * tau,
      a: (tau) => a0 + (360 * turns * tau) / flight,
      x: (tau) => xt + (drift * tau) / flight,
    });
    t += flight;
    angle = a0 + 360 * turns;
    x = xt + drift;
  });

  // Final landing: from -v_last to rest.
  const vLast = o.jumps.length ? o.jumps[o.jumps.length - 1].v0 : 0;
  const aEnd = angle;
  const xEnd = x;
  if (vLast > 0) {
    const T = contact;
    // h'(0) = -v, h(T) = 0, h'(T) = 0  ->  h = -v τ + c τ² + d τ³
    const det = T * T * 3 * T * T - T * T * T * 2 * T;
    const c = (vLast * T * 3 * T * T - T * T * T * vLast) / det;
    const d = (T * T * vLast - 2 * T * vLast * T) / det;
    pieces.push({ t0: t, t1: t + T, h: (tau) => -vLast * tau + c * tau * tau + d * tau ** 3, a: () => aEnd, x: () => xEnd });
    t += T;
  }
  pieces.push({ t0: t, t1: t + tail, h: () => 0, a: () => aEnd, x: () => xEnd });
  t += tail;

  const n = Math.floor(t * fps) + 1;
  const hip = new Float64Array(n);
  const ang = new Float64Array(n);
  const hx = new Float64Array(n);
  const frames: Keypoint[][] = [];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = i / fps;
    const p = pieces.find((q) => ti >= q.t0 && ti < q.t1) ?? pieces[pieces.length - 1];
    const tau = ti - p.t0;
    hip[i] = p.h(tau);
    ang[i] = p.a(tau);
    hx[i] = p.x(tau);
    const base = standingPose(hx[i], bedY - hip[i] * pxPerM, H);
    frames.push(rotateAbout(base, { x: hx[i], y: bedY - hip[i] * pxPerM - 0.53 * H }, ang[i]));
    times.push(ti);
  }
  truth.hipHeightM = hip;
  truth.angleDeg = ang;
  truth.hipX = hx;
  return {
    track: { width: 640, height: 720, fps, sourceFps: fps, times, frames, backend: 'synthetic' },
    truth,
  };
}

/** Small deterministic PRNG so tests are repeatable. Returns values in [-1, 1). */
export function makeRng(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Adds uniform landmark noise (px) in place-safe fashion. */
export function addNoise(track: PoseTrack, noisePx: number, seed = 3): PoseTrack {
  const rnd = makeRng(seed);
  return {
    ...track,
    frames: track.frames.map((f) => f && f.map((p) => ({ ...p, x: p.x + noisePx * rnd(), y: p.y + noisePx * rnd() }))),
  };
}
