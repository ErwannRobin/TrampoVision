import { describe, expect, it } from 'vitest';
import { bridgeFlightGaps } from './ballistic';
import { computeAnalysis } from './computeAnalysis';
import { syntheticRoutine } from './testTracks';
import type { PoseTrack } from './types';

const FPS = 30;
const PX_PER_M = 100;
const G_PX = 9.81 * PX_PER_M;

/** A center of mass in free fall from t = 0 (image y, down): launched at `v0` m/s, drifting sideways. */
function flight(v0: number, frames: number, driftPx = 0): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(frames);
  const y = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    x[i] = 300 + driftPx * t;
    y[i] = 500 - (v0 * t - 0.5 * 9.81 * t * t) * PX_PER_M;
  }
  return { x, y };
}

const hole = (a: Float64Array, from: number, to: number) => a.map((v, i) => (i >= from && i < to ? NaN : v));
const input = (x: ArrayLike<number>, y: ArrayLike<number>) => ({
  x,
  y,
  fps: FPS,
  gravityPx: G_PX,
  bodyLengthPx: 160,
});

describe('bridgeFlightGaps', () => {
  it('puts the center of mass back on the parabola through the top of a flight', () => {
    // 1.6 s in the air; the athlete is lost for 0.6 s around the apex.
    const truth = flight(7.85, 49, 40);
    const out = bridgeFlightGaps(input(hole(truth.x, 15, 33), hole(truth.y, 15, 33)));
    expect(out.gaps).toBe(1);
    for (let i = 15; i < 33; i++) {
      expect(out.bridged[i]).toBe(1);
      expect(Math.abs(out.y[i] - truth.y[i])).toBeLessThan(1);
      expect(Math.abs(out.x[i] - truth.x[i])).toBeLessThan(1);
    }
    // What was measured is not touched.
    expect(out.bridged[14]).toBe(0);
    expect(out.y[14]).toBe(truth.y[14]);
  });

  it('holds with noisy sightings on both sides', () => {
    const truth = flight(8.3, 51);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const y = truth.y.map((v) => v + 3 * rnd());
    const out = bridgeFlightGaps(input(hole(truth.x, 18, 32), hole(y, 18, 32)));
    expect(out.gaps).toBe(1);
    for (let i = 18; i < 32; i++) expect(Math.abs(out.y[i] - truth.y[i])).toBeLessThan(12);
  });

  it('does not bridge a gap over a bed contact, nor one while the athlete stands', () => {
    // Down, the bed, up again: the two sides are in free fall, but not in the same flight.
    const down = flight(0, 12).y;
    const y = new Float64Array(40).fill(NaN);
    for (let i = 0; i < 12; i++) {
      y[i] = down[i];
      y[39 - i] = down[i];
    }
    const x = new Float64Array(40).fill(300);
    expect(bridgeFlightGaps(input(x, y)).gaps).toBe(0);

    const standing = new Float64Array(40).fill(480);
    expect(bridgeFlightGaps(input(x, hole(standing, 10, 25))).gaps).toBe(0);
  });

  it('does not bridge when the fall is not gravity, when the gap is too long, or with too little on one side', () => {
    const truth = flight(7.85, 49);
    const gap = () => [hole(truth.x, 15, 33), hole(truth.y, 15, 33)] as const;
    // A scale four times off (or a slow-motion clip): the parabola is not the one of a free fall.
    expect(bridgeFlightGaps({ ...input(...gap()), gravityPx: 4 * G_PX }).gaps).toBe(0);
    expect(bridgeFlightGaps({ ...input(...gap()), gravityPx: NaN }).gaps).toBe(0);
    expect(bridgeFlightGaps(input(...gap()), { maxGapS: 0.5 }).gaps).toBe(0);
    // Two sightings before the gap are not enough to tell a path.
    const short = [hole(hole(truth.x, 0, 13), 15, 33), hole(hole(truth.y, 0, 13), 15, 33)] as const;
    expect(bridgeFlightGaps(input(...short)).gaps).toBe(0);
  });
});

describe('the athlete lost in mid-flight', () => {
  const lose = (track: PoseTrack, from: number, to: number): PoseTrack => ({
    ...track,
    frames: track.frames.map((f, i) => (i >= from && i < to ? null : f)),
  });

  it('still finds the jump, its apex and its flight time when the top of the flight is not seen', () => {
    const { track, truth } = syntheticRoutine({ jumps: [{ v0: 4.5 }, { v0: 7.8 }, { v0: 4.5 }] });
    const apex = Math.round(truth.apex[1] * 30);
    // Half a second around the apex: longer than the landmarks are bridged for.
    const lost = lose(track, apex - 7, apex + 8);
    const result = computeAnalysis(lost);
    expect(result.jumps.cycles).toHaveLength(3);
    const jump = result.jumps.cycles[1];
    expect(Math.abs(jump.apexTimeS - truth.apex[1])).toBeLessThan(0.04);
    expect(Math.abs(jump.flightTimeS! - truth.flight[1])).toBeLessThan(0.06);
    expect(Math.abs(jump.riseM! - truth.rise[1])).toBeLessThan(0.15);
    // The center of mass is there, marked as put on the parabola; the joints are not made up.
    for (let i = apex - 7; i < apex + 8; i++) {
      expect(result.comBridged[i]).toBe(1);
      expect(Number.isFinite(result.comY[i])).toBe(true);
      expect(result.landmarks[i]).toBeNull();
    }
    // The frames where the athlete was seen are counted as before: a bridge is not a sighting.
    expect(result.summary.validFraction).toBeCloseTo(1 - 15 / track.frames.length, 6);
  });

  it('changes nothing on a track without such a hole', () => {
    const { track } = syntheticRoutine({ jumps: [{ v0: 4.5 }, { v0: 6, turns: 1 }] });
    const result = computeAnalysis(track);
    expect(Array.from(result.comBridged).every((v) => v === 0)).toBe(true);
  });
});
