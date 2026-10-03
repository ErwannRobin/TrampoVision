import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION_CONFIG } from './config';
import { ColumnRhythm } from './rhythm';

const FPS = 30;
const COLUMNS = 3;

/** Feeds `seconds` of a signal into column 1 (the others stay silent) and reads the rhythm at the end. */
function read(signal: (t: number) => number, seconds: number) {
  const rhythm = new ColumnRhythm(COLUMNS, DEFAULT_MOTION_CONFIG);
  const sample = new Float32Array(COLUMNS);
  for (let f = 0; f < Math.round(seconds * FPS); f++) {
    sample[1] = signal(f / FPS);
    rhythm.push(sample);
  }
  return rhythm.read(FPS);
}

/** Up for half a period, down for the other half: the direction of the motion of an athlete who jumps. */
const jumping = (period: number) => (t: number) => (Math.sin((2 * Math.PI * t) / period) >= 0 ? -1 : 1);

/** Short events (up for 4 frames, then down for 4) starting at these times, nothing in between: someone who passes through the column. */
const events = (starts: number[]) => (t: number) =>
  starts.reduce((sum, start) => {
    const since = t - start;
    return sum + (since >= 0 && since < 0.13 ? -1 : since >= 0.13 && since < 0.27 ? 1 : 0);
  }, 0);

/** A small deterministic noise, so a test cannot pass or fail by luck. */
function noise(seed: number): () => number {
  let a = seed;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296 - 0.5;
  };
}

describe('the rhythm of a column', () => {
  it('finds the period of a motion that goes up and down', () => {
    const reading = read(jumping(1.1), 8);
    expect(reading.strength[1]).toBeGreaterThan(0.8);
    expect(reading.periodS).toBeGreaterThan(1.0);
    expect(reading.periodS).toBeLessThan(1.2);
    expect(reading.fit).toBeGreaterThan(0.8);
  });

  it('finds the slow rhythm of a high skill too', () => {
    const reading = read(jumping(2.2), 8);
    expect(reading.strength[1]).toBeGreaterThan(0.7);
    expect(reading.periodS).toBeGreaterThan(2.0);
    expect(reading.periodS).toBeLessThan(2.4);
  });

  it('says nothing for the columns where nothing moves', () => {
    const reading = read(jumping(1.1), 8);
    expect(reading.strength[0]).toBe(0);
    expect(reading.strength[2]).toBe(0);
  });

  it('waits until two and a half periods have been seen', () => {
    expect(read(jumping(1.1), 2).strength[1]).toBe(0);
    expect(read(jumping(1.1), 2).periodS).toBeNull();
    expect(read(jumping(1.1), 4).strength[1]).toBeGreaterThan(0.6);
  });

  it('does not take noise for a rhythm', () => {
    const random = noise(11);
    const reading = read(() => 2 * random(), 8);
    expect(reading.strength[1]).toBeLessThan(DEFAULT_MOTION_CONFIG.minRhythm);
  });

  it('does not take two events for a rhythm: two events the same time apart correlate, but there is no third', () => {
    expect(read(events([5.4, 7.0]), 8).strength[1]).toBeLessThan(DEFAULT_MOTION_CONFIG.minRhythm);
  });

  it('takes the same events for a rhythm once they repeat', () => {
    expect(read(events([1.0, 2.6, 4.2, 5.8, 7.4]), 8).strength[1]).toBeGreaterThan(DEFAULT_MOTION_CONFIG.minRhythm);
  });

  it('does not take a hand that waves for a jump: it repeats every 0.5 s, so it repeats every 1 s too', () => {
    const reading = read(jumping(0.5), 8);
    expect(reading.strength[1]).toBe(0);
    expect(reading.periodS).toBeNull();
  });

  it('does not take a slow drift for a rhythm: it never goes to the other side of its mean in a period', () => {
    const reading = read((t) => (t % 6) / 6, 8);
    expect(reading.strength[1]).toBeLessThan(DEFAULT_MOTION_CONFIG.minRhythm);
  });

  it('forgets everything on reset', () => {
    const rhythm = new ColumnRhythm(COLUMNS, DEFAULT_MOTION_CONFIG);
    const sample = new Float32Array(COLUMNS);
    for (let f = 0; f < 8 * FPS; f++) {
      sample[1] = jumping(1.1)(f / FPS);
      rhythm.push(sample);
    }
    expect(rhythm.read(FPS).strength[1]).toBeGreaterThan(0.8);
    rhythm.reset();
    expect(rhythm.read(FPS).strength[1]).toBe(0);
  });
});

describe('moving the columns with the camera', () => {
  /** A rhythm in column 1 of 5, then the camera moves by `by` columns, and the rhythm is read again. */
  function readAfterShift(by: number) {
    const columns = 5;
    const rhythm = new ColumnRhythm(columns, DEFAULT_MOTION_CONFIG);
    const sample = new Float32Array(columns);
    const signal = jumping(1.2);
    for (let f = 0; f < 8 * FPS; f++) {
      sample[1] = signal(f / FPS);
      rhythm.push(sample);
    }
    rhythm.shift(by);
    return rhythm.read(FPS).strength;
  }

  it('moves what a column knew to the column the athlete is in now', () => {
    expect(readAfterShift(0)[1]).toBeGreaterThan(0.5);
    const right = readAfterShift(2);
    expect(right[3]).toBeGreaterThan(0.5);
    expect(right[1]).toBe(0);
    const left = readAfterShift(-1);
    expect(left[0]).toBeGreaterThan(0.5);
    expect(left[1]).toBe(0);
  });

  it('starts again in the columns that come into view, and forgets all of it for a move of the whole picture', () => {
    expect(Math.max(...readAfterShift(4))).toBe(0);
    expect(Math.max(...readAfterShift(-9))).toBe(0);
  });
});
