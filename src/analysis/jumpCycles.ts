import { argExtreme, findPeaks, solveLinearSystem } from './signal';

/** Per-frame phase of the trampoline cycle. */
export const JUMP_PHASES = ['unknown', 'ground', 'takeoff', 'ascent', 'apex', 'descent', 'landing'] as const;
export type JumpPhase = (typeof JUMP_PHASES)[number];
export const PHASE = Object.fromEntries(JUMP_PHASES.map((p, i) => [p, i])) as Record<JumpPhase, number>;

export const GRAVITY = 9.81;

/**
 * How high the center of mass rises above its takeoff, from the time in the air alone: it climbs for half of the flight under gravity,
 * so rise = g (T / 2)² / 2 = g T² / 8. It needs no scale (nothing is measured in pixels), only that the landing is at the height of the
 * takeoff, which is what the trampoline bed gives. Null when the flight time is not known.
 */
export function riseFromFlightTime(flightTimeS: number | null | undefined, g = GRAVITY): number | null {
  return flightTimeS != null && Number.isFinite(flightTimeS) && flightTimeS > 0 ? (g * flightTimeS ** 2) / 8 : null;
}

export interface JumpInput {
  fps: number;
  /** Sample times, seconds. */
  time: Float64Array;
  /** Center-of-mass height, meters (any fixed reference). NaN = no data. */
  height: Float64Array;
  /** Center-of-mass vertical velocity, m/s, up = +. */
  vy: Float64Array;
  /** Horizontal center-of-mass position, meters. NaN = no data. */
  x: Float64Array;
  /** Continuous (unwrapped) body orientation, degrees. NaN = no data. */
  orientation: Float64Array;
}

export interface JumpOptions {
  /** A jump needs the center of mass to rise at least this much above the valley before it. */
  minRiseM: number;
  /** Two apexes closer than this (seconds) are the same jump. */
  minApexSeparationS: number;
}

export const DEFAULT_JUMP_OPTIONS: JumpOptions = { minRiseM: 0.3, minApexSeparationS: 0.3 };

export interface JumpCycle {
  /** 0-based order in the clip. */
  index: number;
  /** Sample index of each event (the nearest frame). Takeoff/landing are null when the clip starts or ends mid-flight. */
  takeoff: number | null;
  apex: number;
  landing: number | null;
  /** Event times in seconds, between frames where the fit allows. */
  takeoffTimeS: number | null;
  apexTimeS: number;
  landingTimeS: number | null;
  flightTimeS: number | null;
  timeToApexS: number | null;
  /** Height of the highest point of the free-fall curve, meters (same reference as the height series). */
  apexHeightM: number;
  takeoffHeightM: number | null;
  landingHeightM: number | null;
  /** Apex height above the takeoff height: the height actually gained in the air. */
  riseM: number | null;
  /** Vertical speed of the center of mass at takeoff / landing (m/s; landing is negative). */
  takeoffVyMps: number | null;
  landingVyMps: number | null;
  /** Takeoff speed implied by the time to apex (g x t): independent of the pixel scale. */
  ballisticTakeoffVyMps: number | null;
  /** Horizontal center-of-mass position (meters) at takeoff / apex / landing. */
  xTakeoffM: number | null;
  xApexM: number | null;
  xLandingM: number | null;
  /** Landing minus takeoff position, meters (+ = right in the image). */
  horizontalDisplacementM: number | null;
  /** Net body rotation between takeoff and landing, degrees (+ = clockwise in the image). */
  rotationDeg: number | null;
  turns: number | null;
  /** Rotation rounded to the nearest quarter turn. */
  quarterTurns: number | null;
  /** Whole somersaults completed (quarter turns / 4, toward zero). */
  completedRotations: number | null;
  /** Free-fall check: acceleration fitted to the middle of the flight. ~9.81 when the scale is right. */
  impliedGravityMps2: number | null;
  /** True when both takeoff and landing were found. */
  complete: boolean;
}

export interface JumpAnalysis {
  cycles: JumpCycle[];
  /** Per sample: index into JUMP_PHASES. */
  phase: Uint8Array;
  /** Per sample: index of the cycle the sample belongs to (from takeoff to landing), else -1. */
  cycleIndex: Int16Array;
  /** Per sample: turns since the takeoff of the latest jump, frozen at landing. NaN before any takeoff. */
  turnsSinceTakeoff: Float64Array;
  /** Per sample: whole somersaults completed so far in the latest jump. */
  completedRotations: Int16Array;
}

/** Least-squares parabola y = c0 + c1 u + c2 u^2 over the given points. */
function fitQuadratic(us: number[], ys: number[]): [number, number, number] | null {
  if (us.length < 4) return null;
  const A = new Array<number>(9).fill(0);
  const b = [0, 0, 0];
  for (let k = 0; k < us.length; k++) {
    const pw = [1, us[k], us[k] ** 2, us[k] ** 3, us[k] ** 4];
    for (let r = 0; r < 3; r++) {
      b[r] += pw[r] * ys[k];
      for (let c = 0; c < 3; c++) A[r * 3 + c] += pw[r + c];
    }
  }
  const c = solveLinearSystem(A, b, 3);
  return c ? [c[0], c[1], c[2]] : null;
}

interface FlightFit {
  tApex: number;
  hApex: number;
  /** Fitted downward acceleration, m/s^2 (~9.81 with a correct scale). */
  g: number;
}

/** Parabola through the samples of one flight (times within +-halfSpan of `center`). */
function fitFlight(time: Float64Array, height: Float64Array, center: number, halfSpan: number): FlightFit | null {
  const us: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (Math.abs(time[i] - center) > halfSpan || !Number.isFinite(height[i])) continue;
    us.push(time[i] - center);
    ys.push(height[i]);
  }
  const c = fitQuadratic(us, ys);
  if (!c || !(c[2] < 0)) return null;
  const uApex = -c[1] / (2 * c[2]);
  return { tApex: center + uApex, hApex: c[0] - (c[1] * c[1]) / (4 * c[2]), g: -2 * c[2] };
}

interface Boundary {
  time: number;
  height: number;
  /** Vertical speed at the boundary, m/s (up = +). */
  vy: number;
}

/**
 * Locates the instant the athlete leaves (or touches) the bed, as the point where the motion changes
 * from free fall (acceleration = -g) to bed contact (any other constant acceleration). The height
 * curve is continuous and so is the velocity, so only the acceleration jumps at that instant; a
 * two-piece parabola fit finds it: for each candidate time the flight side is forced to follow
 * h = hT + v t - g t^2 / 2 and the contact side gets a free constant acceleration, and the candidate
 * with the smallest squared error wins. This avoids the lag that comes from reading the event off a
 * smoothed velocity curve.
 */
function refineBoundary(
  time: Float64Array,
  height: Float64Array,
  coarse: number,
  kind: 'takeoff' | 'landing',
  g: number,
  flightSpan: number,
  contactSpan: number,
  dt: number,
): Boundary | null {
  const before = kind === 'takeoff' ? contactSpan : flightSpan;
  const after = kind === 'takeoff' ? flightSpan : contactSpan;
  const ts: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (time[i] < coarse - before || time[i] > coarse + after || !Number.isFinite(height[i])) continue;
    ts.push(time[i]);
    hs.push(height[i]);
  }
  if (ts.length < 8) return null;

  // The coarse estimate lags inward (later takeoff, earlier landing), so search mostly outward.
  const step = Math.max(dt / 8, 0.002);
  let best: (Boundary & { sse: number }) | null = null;
  for (let offset = -0.16; offset <= 0.06 + 1e-9; offset += step) {
    const cand = kind === 'takeoff' ? coarse + offset : coarse - offset;
    const A = new Array<number>(9).fill(0);
    const b = [0, 0, 0];
    let nContact = 0;
    let nFlight = 0;
    for (let k = 0; k < ts.length; k++) {
      const tau = ts[k] - cand;
      const flight = kind === 'takeoff' ? tau >= 0 : tau <= 0;
      const y = flight ? hs[k] + 0.5 * g * tau * tau : hs[k];
      const r = [1, tau, flight ? 0 : 0.5 * tau * tau];
      if (flight) nFlight++;
      else nContact++;
      for (let p = 0; p < 3; p++) {
        b[p] += r[p] * y;
        for (let q = 0; q < 3; q++) A[p * 3 + q] += r[p] * r[q];
      }
    }
    if (nContact < 3 || nFlight < 4) continue;
    const c = solveLinearSystem(A, b, 3);
    if (!c) continue;
    let sse = 0;
    for (let k = 0; k < ts.length; k++) {
      const tau = ts[k] - cand;
      const flight = kind === 'takeoff' ? tau >= 0 : tau <= 0;
      const model = flight ? c[0] + c[1] * tau - 0.5 * g * tau * tau : c[0] + c[1] * tau + 0.5 * c[2] * tau * tau;
      sse += (hs[k] - model) ** 2;
    }
    if (!best || sse < best.sse) best = { time: cand, height: c[0], vy: c[1], sse };
  }
  return best ? { time: best.time, height: best.height, vy: best.vy } : null;
}

/** Linear interpolation of a series at a fractional time; null if either neighbour is missing. */
function interpolateAt(time: Float64Array, series: Float64Array, t: number): number | null {
  const n = time.length;
  if (n < 2) return null;
  const f = ((t - time[0]) / (time[n - 1] - time[0])) * (n - 1);
  const i0 = Math.min(Math.max(Math.floor(f), 0), n - 2);
  const a = series[i0];
  const b = series[i0 + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const w = Math.min(Math.max(f - i0, 0), 1);
  return a + (b - a) * w;
}

const nearestIndex = (time: Float64Array, t: number) =>
  Math.min(
    Math.max(Math.round(((t - time[0]) / (time[time.length - 1] - time[0])) * (time.length - 1)), 0),
    time.length - 1,
  );

/**
 * Finds the jumps in a clip from the center-of-mass motion alone (no skill knowledge).
 *
 *  - Apex: a peak of the COM height that rises at least `minRiseM` above its surroundings. The exact
 *    height and time come from a parabola fitted to the middle of the flight.
 *  - Takeoff / landing: first found roughly as the largest upward / downward velocity around the apex,
 *    then refined to the instant where free fall (a = -g) starts / ends (see `refineBoundary`).
 *  - Ascent / descent are the stretches between those events; every other frame is on the bed.
 *
 * A clip that starts or ends in the air still reports the jump, with takeoff or landing left null.
 */
export function detectJumps(input: JumpInput, options: Partial<JumpOptions> = {}): JumpAnalysis {
  const o = { ...DEFAULT_JUMP_OPTIONS, ...options };
  const { fps, time, height, vy, x, orientation } = input;
  const n = height.length;
  const dt = 1 / fps;

  const apexes = findPeaks(height, o.minRiseM, Math.max(1, Math.round(o.minApexSeparationS * fps)));
  const firstFinite = height.findIndex(Number.isFinite);

  // Pass 1: coarse events from the velocity extremes.
  interface Coarse {
    apex: number;
    takeoff: number | null;
    landing: number | null;
  }
  const coarse: Coarse[] = apexes.map((a, k) => {
    const from = k === 0 ? Math.max(0, firstFinite) : apexes[k - 1];
    const to = k === apexes.length - 1 ? n - 1 : apexes[k + 1];
    const valleyBefore = argExtreme(height, from, a, 'min');
    const valleyAfter = argExtreme(height, a, to, 'min');
    const tk = argExtreme(vy, valleyBefore, a, 'max');
    const ld = argExtreme(vy, a, valleyAfter, 'min');
    return {
      apex: a,
      takeoff: tk >= 0 && tk !== valleyBefore ? tk : null,
      landing: ld >= 0 && ld !== valleyAfter ? ld : null,
    };
  });

  // Pass 2: free-fall fit, refined events and metrics.
  const cycles: JumpCycle[] = coarse.map((c, k) => {
    const a = c.apex;
    const tA0 = time[a];
    const toTakeoff = c.takeoff === null ? a * dt : tA0 - time[c.takeoff];
    const toLanding = c.landing === null ? (n - 1 - a) * dt : time[c.landing] - tA0;
    const flight = fitFlight(time, height, tA0, 0.7 * Math.min(toTakeoff, toLanding));
    const g = flight && flight.g > 0.4 * GRAVITY && flight.g < 2.5 * GRAVITY ? flight.g : GRAVITY;
    const tApex = flight ? flight.tApex : tA0;
    const hApex = flight ? flight.hApex : height[a];

    const prevLanding = k > 0 ? coarse[k - 1].landing : null;
    const nextTakeoff = k < coarse.length - 1 ? coarse[k + 1].takeoff : null;
    const gapBefore = c.takeoff !== null && prevLanding !== null ? time[c.takeoff] - time[prevLanding] : Infinity;
    const gapAfter = c.landing !== null && nextTakeoff !== null ? time[nextTakeoff] - time[c.landing] : Infinity;

    const take =
      c.takeoff === null
        ? null
        : refineBoundary(
            time,
            height,
            time[c.takeoff],
            'takeoff',
            g,
            Math.min(0.3, 0.5 * toTakeoff),
            Math.min(0.3, 0.8 * gapBefore),
            dt,
          );
    const land =
      c.landing === null
        ? null
        : refineBoundary(
            time,
            height,
            time[c.landing],
            'landing',
            g,
            Math.min(0.3, 0.5 * toLanding),
            Math.min(0.3, 0.8 * gapAfter),
            dt,
          );

    // Fall back to the coarse estimate when the refinement had too little data.
    const takeoffTimeS = c.takeoff === null ? null : take ? take.time : time[c.takeoff];
    const landingTimeS = c.landing === null ? null : land ? land.time : time[c.landing];
    const takeoff = takeoffTimeS === null ? null : Math.min(nearestIndex(time, takeoffTimeS), a - 1);
    const landing = landingTimeS === null ? null : Math.max(nearestIndex(time, landingTimeS), a + 1);
    const takeoffHeightM = take
      ? take.height
      : takeoff === null || !Number.isFinite(height[takeoff])
        ? null
        : height[takeoff];
    const landingHeightM = land
      ? land.height
      : landing === null || !Number.isFinite(height[landing])
        ? null
        : height[landing];
    const both = takeoffTimeS !== null && landingTimeS !== null;

    const rotAt = (t: number | null) => (t === null ? null : interpolateAt(time, orientation, t));
    const oT = rotAt(takeoffTimeS);
    const oL = rotAt(landingTimeS);
    const rotationDeg = both && oT !== null && oL !== null ? oL - oT : null;
    const quarterTurns = rotationDeg === null ? null : Math.round(rotationDeg / 90);
    const xT = takeoffTimeS === null ? null : interpolateAt(time, x, takeoffTimeS);
    const xL = landingTimeS === null ? null : interpolateAt(time, x, landingTimeS);
    const timeToApexS = takeoffTimeS === null ? null : tApex - takeoffTimeS;

    return {
      index: k,
      takeoff,
      apex: a,
      landing,
      takeoffTimeS,
      apexTimeS: tApex,
      landingTimeS,
      flightTimeS: both ? landingTimeS! - takeoffTimeS! : null,
      timeToApexS,
      apexHeightM: hApex,
      takeoffHeightM,
      landingHeightM,
      riseM: takeoffHeightM === null ? null : hApex - takeoffHeightM,
      takeoffVyMps: take ? take.vy : takeoff === null || !Number.isFinite(vy[takeoff]) ? null : vy[takeoff],
      landingVyMps: land ? land.vy : landing === null || !Number.isFinite(vy[landing]) ? null : vy[landing],
      ballisticTakeoffVyMps: timeToApexS === null ? null : GRAVITY * timeToApexS,
      xTakeoffM: xT,
      xApexM: interpolateAt(time, x, tApex),
      xLandingM: xL,
      horizontalDisplacementM: xT !== null && xL !== null ? xL - xT : null,
      rotationDeg,
      turns: rotationDeg === null ? null : rotationDeg / 360,
      quarterTurns,
      completedRotations: quarterTurns === null ? null : Math.trunc(quarterTurns / 4),
      impliedGravityMps2: flight ? flight.g : null,
      complete: both,
    };
  });

  // Per-sample labels.
  const phase = new Uint8Array(n);
  const cycleIndex = new Int16Array(n).fill(-1);
  const turnsSinceTakeoff = new Float64Array(n).fill(NaN);
  const completedRotations = new Int16Array(n);
  for (let i = 0; i < n; i++) phase[i] = Number.isFinite(height[i]) ? PHASE.ground : PHASE.unknown;

  let held = NaN;
  let heldDone = 0;
  let cursor = 0;
  for (const c of cycles) {
    const start = c.takeoff ?? Math.max(0, firstFinite);
    const end = c.landing ?? n - 1;
    for (let i = start; i <= end; i++) {
      if (!Number.isFinite(height[i])) continue;
      phase[i] = i < c.apex ? PHASE.ascent : i > c.apex ? PHASE.descent : PHASE.apex;
      cycleIndex[i] = c.index;
    }
    if (c.takeoff !== null) phase[c.takeoff] = PHASE.takeoff;
    if (c.landing !== null) phase[c.landing] = PHASE.landing;

    // Running rotation count: reset at each takeoff, frozen at landing.
    if (c.takeoff !== null) {
      for (let i = cursor; i < c.takeoff; i++) {
        turnsSinceTakeoff[i] = held;
        completedRotations[i] = heldDone;
      }
      const base = interpolateAt(time, orientation, c.takeoffTimeS!) ?? orientation[c.takeoff];
      const last = c.landing ?? n - 1;
      for (let i = c.takeoff; i <= last; i++) {
        const deg = orientation[i] - base;
        turnsSinceTakeoff[i] = Number.isFinite(deg) ? deg / 360 : NaN;
        completedRotations[i] = Number.isFinite(deg) ? Math.trunc(Math.round(deg / 90) / 4) : 0;
      }
      held = turnsSinceTakeoff[last];
      heldDone = completedRotations[last];
      cursor = last + 1;
    }
  }
  for (let i = cursor; i < n; i++) {
    turnsSinceTakeoff[i] = held;
    completedRotations[i] = heldDone;
  }

  return { cycles, phase, cycleIndex, turnsSinceTakeoff, completedRotations };
}
