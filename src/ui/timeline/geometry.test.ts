import { describe, expect, it } from 'vitest';
import {
  flightSpan,
  jumpAt,
  jumpWindow,
  lowConfidenceSpans,
  MIN_ZOOM_SPAN_S,
  mixWindows,
  nearestEvent,
  rulerTicks,
  timelineEvents,
  timeToX,
  xToTime,
  type CycleTimes,
} from './geometry';

const clip = { t0: 0, t1: 20 };
const plot = { left: 10, width: 400 };
const cycles: CycleTimes[] = [
  { index: 0, takeoffTimeS: 2, apexTimeS: 2.6, landingTimeS: 3.2 },
  { index: 1, takeoffTimeS: 5, apexTimeS: 5.6, landingTimeS: 6.2 },
  { index: 2, takeoffTimeS: 19, apexTimeS: 19.6, landingTimeS: null },
];

describe('time and pixels', () => {
  it('maps the window onto the plot and back', () => {
    expect(timeToX(0, clip, plot)).toBe(10);
    expect(timeToX(20, clip, plot)).toBe(410);
    expect(timeToX(10, clip, plot)).toBe(210);
    expect(xToTime(210, clip, plot)).toBeCloseTo(10);
  });
  it('holds a pixel outside the plot inside the window', () => {
    expect(xToTime(-50, clip, plot)).toBe(0);
    expect(xToTime(999, clip, plot)).toBe(20);
  });
  it('follows a zoomed window', () => {
    const win = { t0: 4, t1: 8 };
    expect(timeToX(6, win, plot)).toBe(210);
    expect(xToTime(410, win, plot)).toBe(8);
  });
});

describe('flights', () => {
  it('runs from takeoff to landing', () => {
    expect(flightSpan(cycles[0], clip)).toEqual({ start: 2, end: 3.2, openStart: false, openEnd: false });
  });
  it('ends at the edge of the clip when the landing was cut off', () => {
    expect(flightSpan(cycles[2], clip)).toEqual({ start: 19, end: 20, openStart: false, openEnd: true });
    expect(flightSpan({ takeoffTimeS: null, landingTimeS: 1 }, clip)).toMatchObject({ start: 0, openStart: true });
  });
  it('finds the jump at a time, or none on the bed', () => {
    expect(jumpAt(2.5, cycles, clip)).toBe(0);
    expect(jumpAt(5.6, cycles, clip)).toBe(1);
    expect(jumpAt(4, cycles, clip)).toBe(-1);
    expect(jumpAt(19.9, cycles, clip)).toBe(2);
  });
  it('lists the events that exist', () => {
    const events = timelineEvents(cycles);
    expect(events).toHaveLength(8);
    expect(events.filter((e) => e.jump === 2).map((e) => e.kind)).toEqual(['takeoff', 'apex']);
  });
  it('finds the closest event under the pointer', () => {
    const events = timelineEvents(cycles);
    const x = timeToX(2.6, clip, plot);
    expect(nearestEvent(x + 3, events, clip, plot)).toMatchObject({ kind: 'apex', jump: 0 });
    expect(nearestEvent(timeToX(4, clip, plot), events, clip, plot)).toBeNull();
  });
});

describe('zoom window', () => {
  it('surrounds a flight with a margin', () => {
    const win = jumpWindow(flightSpan(cycles[1], clip), clip, 0.25);
    expect(win.t1 - win.t0).toBeCloseTo(Math.max(1.2 * 1.5, MIN_ZOOM_SPAN_S));
    expect(win.t0).toBeLessThan(5);
    expect(win.t1).toBeGreaterThan(6.2);
  });
  it('stays inside the clip at both ends', () => {
    const early = jumpWindow(flightSpan({ takeoffTimeS: 0.1, landingTimeS: 0.9 }, clip), clip);
    expect(early.t0).toBe(0);
    const late = jumpWindow(flightSpan(cycles[2], clip), clip);
    expect(late.t1).toBeLessThanOrEqual(20);
    expect(late.t1 - late.t0).toBeGreaterThanOrEqual(MIN_ZOOM_SPAN_S - 1e-9);
  });
  it('is never longer than a short clip', () => {
    const short = { t0: 0, t1: 0.5 };
    expect(jumpWindow({ start: 0, end: 0.5, openStart: false, openEnd: false }, short)).toEqual(short);
  });
  it('mixes two windows', () => {
    expect(mixWindows({ t0: 0, t1: 10 }, { t0: 4, t1: 6 }, 0.5)).toEqual({ t0: 2, t1: 8 });
  });
});

describe('ruler', () => {
  it('uses the smallest round step that keeps labels apart', () => {
    const { step, times } = rulerTicks({ t0: 0, t1: 14 }, 700, 60);
    expect(step).toBe(2); // 50 px per second: 1 s is too tight, 2 s is 100 px
    expect(times).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });
  it('starts at the first round time inside the window', () => {
    const { times } = rulerTicks({ t0: 3.3, t1: 6.1 }, 560, 64);
    expect(times[0]).toBeGreaterThanOrEqual(3.3);
    expect(times[times.length - 1]).toBeLessThanOrEqual(6.1);
  });
  it('has nothing to show without room or time', () => {
    expect(rulerTicks({ t0: 1, t1: 1 }, 300).times).toEqual([]);
    expect(rulerTicks({ t0: 0, t1: 5 }, 0).times).toEqual([]);
  });
});

describe('unclear stretches', () => {
  const time = Float64Array.from([0, 1, 2, 3, 4, 5]);
  it('turns low samples into spans', () => {
    const conf = Float64Array.from([1, 0.2, 0.3, 1, 0.1, 0.1]);
    expect(lowConfidenceSpans(time, conf)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ]);
  });
  it('treats a missing value as unclear and finds nothing in a clean clip', () => {
    expect(lowConfidenceSpans(time, Float64Array.from([1, NaN, 1, 1, 1, 1]))).toEqual([{ from: 1, to: 2 }]);
    expect(lowConfidenceSpans(time, Float64Array.from([1, 1, 1, 1, 1, 1]))).toEqual([]);
  });
});
