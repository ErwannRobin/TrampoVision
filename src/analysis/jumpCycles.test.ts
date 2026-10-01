import { describe, expect, it } from 'vitest';
import { detectJumps, GRAVITY, JUMP_PHASES, PHASE, riseFromFlightTime, type JumpInput } from './jumpCycles';
import { localPolyFit, oddWindow } from './signal';
import { makeRng, syntheticRoutine, type RoutineOptions } from './testTracks';

/** Builds detector input from ground-truth pelvis motion, computing vy the same way the app does. */
function inputFrom(opts: RoutineOptions, noiseM = 0, seed = 5, crop?: [number, number]) {
  const { track, truth } = syntheticRoutine(opts);
  const fps = track.fps;
  const rnd = makeRng(seed);
  let height = Float64Array.from(truth.hipHeightM, (h) => h + noiseM * rnd());
  let x = Float64Array.from(truth.hipX, (px) => px / 100);
  let orientation = Float64Array.from(truth.angleDeg);
  let time = Float64Array.from(track.times);
  if (crop) {
    height = height.slice(crop[0], crop[1]);
    x = x.slice(crop[0], crop[1]);
    orientation = orientation.slice(crop[0], crop[1]);
    time = time.slice(crop[0], crop[1]);
  }
  const vy = localPolyFit(height, oddWindow(0.2, fps)).slope.map((s) => s * fps);
  const input: JumpInput = { fps, time, height, vy, x, orientation };
  return { input, truth, fps };
}

const near = (a: number | null, b: number, tol: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol);
};

describe('detectJumps', () => {
  const routine: RoutineOptions = { jumps: [{ v0: 4 }, { v0: 5.5 }, { v0: 4.5 }] };

  it('finds every takeoff, apex and landing within a frame or two (30 fps)', () => {
    const { input, truth, fps } = inputFrom(routine);
    const { cycles } = detectJumps(input);
    expect(cycles).toHaveLength(3);
    const tol = 1.5 / fps; // 50 ms
    cycles.forEach((c, k) => {
      near(c.takeoffTimeS, truth.takeoff[k], tol);
      near(c.apexTimeS, truth.apex[k], 0.5 / fps);
      near(c.landingTimeS, truth.landing[k], tol);
      expect(c.complete).toBe(true);
    });
  });

  it('gives the same accuracy at 60 fps (the limit is the bed-contact model, not the frame rate)', () => {
    const { input, truth } = inputFrom({ ...routine, fps: 60 });
    const { cycles } = detectJumps(input);
    cycles.forEach((c, k) => {
      near(c.takeoffTimeS, truth.takeoff[k], 0.04);
      near(c.landingTimeS, truth.landing[k], 0.04);
    });
  });

  it('computes flight time, time to apex, height gained and velocity', () => {
    const { input, truth } = inputFrom(routine);
    const { cycles } = detectJumps(input);
    cycles.forEach((c, k) => {
      expect(Math.abs(c.flightTimeS! / truth.flight[k] - 1)).toBeLessThan(0.05);
      expect(Math.abs(c.timeToApexS! / (truth.flight[k] / 2) - 1)).toBeLessThan(0.1);
      expect(Math.abs(c.riseM! / truth.rise[k] - 1)).toBeLessThan(0.15);
      expect(Math.abs(c.apexHeightM - truth.rise[k])).toBeLessThan(0.04); // takeoff is at the standing level (0)
      const v0 = routine.jumps[k].v0;
      expect(Math.abs(c.ballisticTakeoffVyMps! / v0 - 1)).toBeLessThan(0.1);
      expect(c.takeoffVyMps!).toBeGreaterThan(v0 * 0.8);
      expect(c.takeoffVyMps!).toBeLessThan(v0 * 1.15);
      expect(c.landingVyMps!).toBeLessThan(-v0 * 0.8);
    });
  });

  it('the free-fall check reads ~9.81 when the scale is right', () => {
    const { input } = inputFrom(routine);
    for (const c of detectJumps(input).cycles) expect(Math.abs(c.impliedGravityMps2! / GRAVITY - 1)).toBeLessThan(0.03);
  });

  it('exposes a scale error through the free-fall check', () => {
    const { input } = inputFrom(routine);
    const stretched = { ...input, height: input.height.map((h) => h * 1.2), vy: input.vy.map((v) => v * 1.2) };
    for (const c of detectJumps(stretched).cycles)
      expect(Math.abs(c.impliedGravityMps2! / GRAVITY - 1.2)).toBeLessThan(0.04);
  });

  it('still works with 1.5 cm of noise on the height', () => {
    const { input, truth } = inputFrom(routine, 0.015);
    const { cycles } = detectJumps(input);
    expect(cycles).toHaveLength(3);
    cycles.forEach((c, k) => {
      near(c.takeoffTimeS, truth.takeoff[k], 0.07);
      near(c.landingTimeS, truth.landing[k], 0.07);
      expect(Math.abs(c.riseM! / truth.rise[k] - 1)).toBeLessThan(0.2);
      expect(Math.abs(c.flightTimeS! / truth.flight[k] - 1)).toBeLessThan(0.06);
    });
  });

  it('ignores small hops but keeps real jumps', () => {
    const { input } = inputFrom({ jumps: [{ v0: 1.6 }, { v0: 4.5 }, { v0: 1.6 }] });
    expect(detectJumps(input).cycles).toHaveLength(1);
  });

  it('labels every frame with exactly one takeoff, apex and landing per jump, in order', () => {
    const { input } = inputFrom(routine);
    const { phase, cycles, cycleIndex } = detectJumps(input);
    const count = (p: keyof typeof PHASE) => Array.from(phase).filter((v) => v === PHASE[p]).length;
    expect(count('takeoff')).toBe(3);
    expect(count('apex')).toBe(3);
    expect(count('landing')).toBe(3);
    const c = cycles[1];
    expect(JUMP_PHASES[phase[c.takeoff!]]).toBe('takeoff');
    expect(JUMP_PHASES[phase[c.takeoff! + 1]]).toBe('ascent');
    expect(JUMP_PHASES[phase[c.apex - 1]]).toBe('ascent');
    expect(JUMP_PHASES[phase[c.apex]]).toBe('apex');
    expect(JUMP_PHASES[phase[c.apex + 1]]).toBe('descent');
    expect(JUMP_PHASES[phase[c.landing!]]).toBe('landing');
    expect(JUMP_PHASES[phase[c.landing! + 1]]).toBe('ground');
    expect(JUMP_PHASES[phase[0]]).toBe('ground');
    expect(cycleIndex[c.apex]).toBe(1);
    expect(cycleIndex[0]).toBe(-1);
  });

  it('reports a jump that is cut off at the start or the end, without inventing events', () => {
    const { input, truth, fps } = inputFrom(routine);
    const midAscent = Math.round((truth.takeoff[0] + 0.1) * fps);
    const midDescent = Math.round((truth.apex[2] + 0.3) * fps);
    const cut = inputFrom(routine, 0, 5, [midAscent, midDescent]);
    const { cycles, phase } = detectJumps(cut.input);
    expect(cycles).toHaveLength(3);
    expect(cycles[0].takeoff).toBeNull();
    expect(cycles[0].complete).toBe(false);
    expect(cycles[0].flightTimeS).toBeNull();
    expect(cycles[2].landing).toBeNull();
    expect(cycles[2].horizontalDisplacementM).toBeNull();
    expect(JUMP_PHASES[phase[0]]).toBe('ascent');
    expect(JUMP_PHASES[phase[phase.length - 1]]).toBe('descent');
    expect(cycles[1].complete).toBe(true);
    void input;
  });

  it('reports nothing for a clip without jumps', () => {
    const { input } = inputFrom({ jumps: [] });
    const r = detectJumps(input);
    expect(r.cycles).toHaveLength(0);
    expect(Array.from(r.phase).every((p) => p === PHASE.ground)).toBe(true);
  });

  it('measures horizontal displacement between takeoff and landing', () => {
    const { input } = inputFrom({
      jumps: [
        { v0: 5, driftM: 0.8 },
        { v0: 5, driftM: -0.5 },
      ],
    });
    const { cycles } = detectJumps(input);
    near(cycles[0].horizontalDisplacementM, 0.8, 0.08);
    near(cycles[1].horizontalDisplacementM, -0.5, 0.08);
  });

  it('counts somersaults from the continuous orientation, to the nearest quarter turn', () => {
    const { input } = inputFrom({
      jumps: [
        { v0: 5, turns: 2 },
        { v0: 5, turns: 1.5 },
        { v0: 5, turns: -1 },
        { v0: 5, turns: 0.9 },
        { v0: 5, turns: 0.5 },
      ],
    });
    const { cycles } = detectJumps(input);
    expect(cycles).toHaveLength(5);
    expect(cycles.map((c) => c.quarterTurns)).toEqual([8, 6, -4, 4, 2]);
    expect(cycles.map((c) => c.completedRotations)).toEqual([2, 1, -1, 1, 0]);
    near(cycles[0].turns, 2, 0.1);
  });

  it('runs a live rotation counter that resets at takeoff and freezes at landing', () => {
    const { input } = inputFrom({
      jumps: [
        { v0: 5, turns: 1 },
        { v0: 5, turns: 2 },
      ],
    });
    const r = detectJumps(input);
    const [a, b] = r.cycles;
    expect(r.turnsSinceTakeoff[a.apex]).toBeGreaterThan(0.4);
    expect(r.turnsSinceTakeoff[a.apex]).toBeLessThan(0.6);
    expect(r.completedRotations[a.landing!]).toBe(1);
    expect(r.turnsSinceTakeoff[a.landing! + 3]).toBeCloseTo(r.turnsSinceTakeoff[a.landing!], 9); // frozen after landing
    expect(Math.abs(r.turnsSinceTakeoff[b.takeoff!])).toBeLessThan(0.05); // reset
    expect(r.completedRotations[b.landing!]).toBe(2);
    expect(Number.isNaN(r.turnsSinceTakeoff[0])).toBe(true); // before any takeoff
  });
});

describe('riseFromFlightTime', () => {
  it('is g T² / 8: the climb takes half of the flight', () => {
    expect(riseFromFlightTime(1.6)).toBeCloseTo((GRAVITY * 1.6 ** 2) / 8, 9);
    expect(riseFromFlightTime(1)).toBeCloseTo(1.226, 3);
    expect(riseFromFlightTime(2)).toBeCloseTo(4.905, 3);
  });
  it('follows the gravity it is given', () => {
    expect(riseFromFlightTime(2, 10)).toBeCloseTo(5, 9);
  });
  it('is null when there is no flight time to go on', () => {
    expect(riseFromFlightTime(null)).toBeNull();
    expect(riseFromFlightTime(undefined)).toBeNull();
    expect(riseFromFlightTime(NaN)).toBeNull();
    expect(riseFromFlightTime(0)).toBeNull();
    expect(riseFromFlightTime(-1)).toBeNull();
  });
  it('matches the rise of the simulated jumps', () => {
    const { input, truth } = inputFrom({ jumps: [{ v0: 4 }, { v0: 5.5 }, { v0: 4.5 }] });
    detectJumps(input).cycles.forEach((c, k) => {
      if (c.flightTimeS !== null)
        expect(Math.abs(riseFromFlightTime(c.flightTimeS)! / truth.rise[k] - 1)).toBeLessThan(0.1);
    });
  });
});
