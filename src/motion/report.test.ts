import { describe, expect, it } from 'vitest';
import { formatSeconds, summarize, type FrameRow } from './report';

const row = (t: number, width: number | null, coverage = 0.2): FrameRow => ({
  t,
  found: width !== null,
  box: width === null ? null : { x0: 10, y0: 5, x1: 10 + width - 1, y1: 40 },
  type: 'fixed',
  coverage: width === null ? 1 : coverage,
  periodS: width === null ? null : 1.5,
});

describe('the summary of a run over a clip', () => {
  it('counts the frames with an athlete, and measures the box widths and the picture kept in them', () => {
    const s = summarize([row(0, null), row(0.1, 10, 0.1), row(0.2, 20, 0.2), row(0.3, 30, 0.3)]);
    expect(s.frames).toBe(4);
    expect(s.found).toBe(3);
    expect(s.width).toEqual({ median: 20, p90: 30, max: 30 });
    expect(s.coverage).toBeCloseTo(0.2);
  });

  it('has nothing to measure when no athlete was found', () => {
    const s = summarize([row(0, null), row(0.1, null)]);
    expect(s.found).toBe(0);
    expect(s.width).toEqual({ median: 0, p90: 0, max: 0 });
    expect(s.coverage).toBe(1);
  });

  it('writes one line a second, from the frame at that second', () => {
    const rows = [row(0, null), row(0.5, 10), row(1, 20), row(1.5, 30), row(2, null)];
    const lines = formatSeconds(rows);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^ {2}0\.0 s {2}- {5}/);
    expect(lines[1]).toMatch(/^ {2}1\.0 s {2}found {2}\[10,5-29,40\]/);
    expect(lines[1]).toContain('fixed');
    expect(lines[1]).toContain('T=1.50 s');
    expect(lines[2]).toMatch(/^ {2}2\.0 s {2}-/);
  });
});
