import { describe, expect, it } from 'vitest';
import { ARCS_VIEW, DRAW_MS, FLIGHTS, flightGeometry, flightTiming, glyphPoints } from './arcs';

const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('flightGeometry', () => {
  it('rises from the takeoff on the baseline to the apex and falls back to the landing', () => {
    const { baseline } = ARCS_VIEW;
    const geo = flightGeometry({ takeoff: 100, landing: 300, height: 120, strength: 1 });
    expect(numbers(geo.ascent).slice(0, 2)).toEqual([100, baseline]);
    expect(numbers(geo.ascent).slice(-2)).toEqual([200, baseline - 120]);
    expect(numbers(geo.descent).slice(0, 2)).toEqual([200, baseline - 120]);
    expect(numbers(geo.descent).slice(-2)).toEqual([300, baseline]);
    expect(geo.apex).toEqual({ x: 200, y: baseline - 120 });
  });

  it('keeps the apex flat: both halves meet it with a horizontal tangent', () => {
    const geo = flightGeometry({ takeoff: 0, landing: 200, height: 50, strength: 1 }, 100);
    const [, , cx, cy, x, y] = numbers(geo.ascent);
    expect(cy).toBe(y);
    expect(cx).toBeLessThan(x);
    const [, , cx2, cy2] = numbers(geo.descent);
    expect(cy2).toBe(50);
    expect(cx2).toBeGreaterThan(100);
  });

  it('is deterministic', () => {
    expect(FLIGHTS.map((f) => flightGeometry(f))).toEqual(FLIGHTS.map((f) => flightGeometry(f)));
  });
});

describe('FLIGHTS', () => {
  it('fit inside the view, with room above the tallest apex', () => {
    for (const f of FLIGHTS) {
      expect(f.takeoff).toBeGreaterThanOrEqual(0);
      expect(f.landing).toBeLessThanOrEqual(ARCS_VIEW.width);
      expect(f.landing).toBeGreaterThan(f.takeoff);
      expect(ARCS_VIEW.baseline - f.height).toBeGreaterThanOrEqual(20);
      expect(f.strength).toBeGreaterThan(0);
      expect(f.strength).toBeLessThanOrEqual(1);
    }
  });

  it('are ordered by takeoff, so they draw from left to right', () => {
    const takeoffs = FLIGHTS.map((f) => f.takeoff);
    expect(takeoffs).toEqual([...takeoffs].sort((a, b) => a - b));
  });

  it('have exactly one hero, the tallest and the strongest', () => {
    const heroes = FLIGHTS.filter((f) => f.hero);
    expect(heroes).toHaveLength(1);
    expect(heroes[0].height).toBe(Math.max(...FLIGHTS.map((f) => f.height)));
    expect(heroes[0].strength).toBe(1);
  });
});

describe('flightTiming', () => {
  it('starts each flight after the one before it, and lets the fall follow the rise', () => {
    for (let i = 1; i < FLIGHTS.length; i++) expect(flightTiming(i).ascent).toBeGreaterThan(flightTiming(i - 1).ascent);
    const t = flightTiming(3);
    expect(t.descent).toBe(t.ascent + DRAW_MS);
    expect(t.apex).toBeGreaterThan(t.ascent);
    expect(t.apex).toBeLessThanOrEqual(t.descent);
  });
});

describe('glyphPoints', () => {
  it('points up for a takeoff and down for a landing', () => {
    expect(glyphPoints(10, 100, 'up')).toBe('10,92 4,104 16,104');
    expect(glyphPoints(10, 100, 'down')).toBe('10,108 4,96 16,96');
  });
});
