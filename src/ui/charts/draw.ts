import { cssVar } from '../theme';
import { withAlpha } from './color';
import { belowRuns, clamp, indexAt, lineRuns, niceTicks, tickLabel, timeLabel, type Plot } from './geometry';
import type { ChartProps } from './types';

/** Canvas drawing shared by the charts. Every color comes from the tokens, so a theme change only needs a redraw. */

export interface ChartColors {
  text: string;
  text2: string;
  text3: string;
  grid: string;
  line2: string;
  surface: string;
  flightBand: string;
  band: string;
  gold: string;
  goldFill: string;
  lift: string;
  drop: string;
  font: string;
  /** One per series, in order. */
  series: string[];
}

export function readColors(seriesVars: readonly string[]): ChartColors {
  return {
    text: cssVar('--text'),
    text2: cssVar('--text-2'),
    text3: cssVar('--text-3'),
    grid: cssVar('--grid'),
    line2: cssVar('--line-2'),
    surface: cssVar('--surface'),
    flightBand: cssVar('--flight-band'),
    band: cssVar('--band'),
    gold: cssVar('--gold'),
    goldFill: cssVar('--gold-fill'),
    lift: cssVar('--lift'),
    drop: cssVar('--drop'),
    font: cssVar('--font', 'system-ui, sans-serif'),
    series: seriesVars.map((v) => cssVar(v)),
  };
}

/** Figures are set condensed, like every measurement in the interface. */
export const figureFont = (c: ChartColors, size: number, weight = 500) => `condensed ${weight} ${size}px ${c.font}`;

/** Sizes the bitmap for the device pixel ratio (only when it changed) and returns a cleared context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function segment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The timeline's glyphs: T = up triangle (takeoff), A = gold dot (apex), L = down triangle (landing). */
export function drawGlyph(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, c: ChartColors) {
  ctx.beginPath();
  if (label === 'A') {
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = c.goldFill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.gold;
    ctx.stroke();
    return;
  }
  const down = label === 'L' ? 1 : -1;
  ctx.moveTo(x, y + down * 3.6);
  ctx.lineTo(x - 4.2, y - down * 3.4);
  ctx.lineTo(x + 4.2, y - down * 3.4);
  ctx.closePath();
  ctx.fillStyle = c.text2;
  ctx.fill();
}

export type ChartLayers = Pick<
  ChartProps,
  'time' | 'series' | 'confidence' | 'breakOnJump' | 'markers' | 'bands' | 'guides' | 'axis'
> & { zeroLine: boolean };

/** The static layer of a chart: flights, unclear stretches, grid, guides, curves and events. */
export function drawChart(ctx: CanvasRenderingContext2D, plot: Plot, d: ChartLayers, c: ChartColors) {
  const { box, px, t0, t1 } = plot;
  if (d.bands?.length) {
    ctx.fillStyle = c.flightBand;
    for (const b of d.bands) {
      const x0 = px(Math.max(b.from, t0));
      const x1 = px(Math.min(b.to, t1));
      if (x1 > x0) ctx.fillRect(x0, box.y0, x1 - x0, box.y1 - box.y0);
    }
  }
  if (d.confidence) hatchUnclear(ctx, plot, d.time, d.confidence, c);
  drawAxes(ctx, plot, d, c);
  if (d.guides?.length) drawGuides(ctx, plot, d.guides, c);
  drawCurves(ctx, plot, d, c);
  if (d.markers?.length) drawEvents(ctx, plot, d, c);
}

/** Stretches where the pose was not clear: a faint tint with hatching, the same grammar as the timeline. */
function hatchUnclear(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  time: Float64Array,
  confidence: Float64Array,
  c: ChartColors,
) {
  const runs = belowRuns(confidence, 0.5, time.length);
  if (!runs.length) return;
  const { box, px } = plot;
  const half = (box.x1 - box.x0) / Math.max(1, time.length - 1) / 2;
  ctx.save();
  ctx.beginPath();
  for (const [a, b] of runs) {
    const x0 = Math.max(box.x0, px(time[a]) - half);
    const x1 = Math.min(box.x1, px(time[b]) + half);
    if (x1 > x0) ctx.rect(x0, box.y0, x1 - x0, box.y1 - box.y0);
  }
  ctx.clip();
  ctx.fillStyle = c.band;
  ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.strokeStyle = c.text3;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  const h = box.y1 - box.y0;
  ctx.beginPath();
  for (let x = box.x0 - h; x < box.x1; x += 7) {
    ctx.moveTo(x, box.y1);
    ctx.lineTo(x + h, box.y0);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAxes(ctx: CanvasRenderingContext2D, plot: Plot, d: ChartLayers, c: ChartColors) {
  const { box, px, py, lo, hi, t0, t1 } = plot;
  ctx.lineWidth = 1;
  ctx.font = figureFont(c, 11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of niceTicks(lo, hi, 4)) {
    const y = Math.round(py(v)) + 0.5;
    ctx.strokeStyle = v === 0 && d.zeroLine ? c.line2 : c.grid;
    segment(ctx, box.x0, y, box.x1, y);
    ctx.fillStyle = c.text3;
    ctx.fillText(tickLabel(v), box.x0 - 8, y);
  }
  ctx.strokeStyle = c.grid;
  segment(ctx, box.x0, box.y1 + 0.5, box.x1, box.y1 + 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = c.text3;
  for (const t of niceTicks(t0, t1, Math.max(3, Math.floor((box.x1 - box.x0) / 80)))) {
    const label = d.axis ? d.axis.tick(t) : timeLabel(t);
    const w = ctx.measureText(label).width;
    ctx.fillText(label, clamp(px(t) - w / 2, 0, plot.width - w), box.y1 + 7);
  }
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  guides: NonNullable<ChartProps['guides']>,
  c: ChartColors,
) {
  const { box, py, lo, hi } = plot;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.line2;
  ctx.fillStyle = c.text3;
  ctx.font = figureFont(c, 10.5);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  let lastLabel = -Infinity;
  for (const g of guides) {
    if (g.value < lo || g.value > hi) continue;
    const y = Math.round(py(g.value)) + 0.5;
    segment(ctx, box.x0, y, box.x1, y);
    // Labels that would touch the previous one are left out; the line still says where the value is.
    if (g.label && Math.abs(y - lastLabel) >= 12) {
      ctx.fillText(g.label, box.x1 - 3, y - 3);
      lastLabel = y;
    }
  }
  ctx.restore();
}

function drawCurves(ctx: CanvasRenderingContext2D, plot: Plot, d: ChartLayers, c: ChartColors) {
  const { box, px, py, lo, hi } = plot;
  const single = d.series.length === 1;
  // A single curve gets a soft wash down to the baseline: the zero line when the curve crosses it, else the bottom.
  const base = d.zeroLine && lo < 0 && hi > 0 ? py(0) : box.y1;
  ctx.lineWidth = 1.75;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  d.series.forEach((s, k) => {
    const runs = lineRuns(s.values, d.breakOnJump);
    const color = c.series[k];
    if (single && runs.length) {
      const g = ctx.createLinearGradient(0, box.y0, 0, box.y1);
      if (base >= box.y1) {
        g.addColorStop(0, withAlpha(color, 0.2));
        g.addColorStop(1, withAlpha(color, 0));
      } else {
        g.addColorStop(0, withAlpha(color, 0.2));
        g.addColorStop((base - box.y0) / (box.y1 - box.y0), withAlpha(color, 0));
        g.addColorStop(1, withAlpha(color, 0.2));
      }
      ctx.fillStyle = g;
      for (const [a, b] of runs) {
        if (a === b) continue;
        ctx.beginPath();
        ctx.moveTo(px(d.time[a]), base);
        for (let i = a; i <= b; i++) ctx.lineTo(px(d.time[i]), py(s.values[i]));
        ctx.lineTo(px(d.time[b]), base);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [a, b] of runs) {
      ctx.moveTo(px(d.time[a]), py(s.values[a]));
      for (let i = a + 1; i <= b; i++) ctx.lineTo(px(d.time[i]), py(s.values[i]));
    }
    ctx.stroke();
    // A lone sample between two gaps has no line to carry it: draw it as a dot.
    ctx.fillStyle = color;
    for (const [a, b] of runs) {
      if (a !== b) continue;
      ctx.beginPath();
      ctx.arc(px(d.time[a]), py(s.values[a]), 1.75, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Takeoff, apex and landing as glyphs on a rail above the plot; the apex also gets a faint line down through it. */
function drawEvents(ctx: CanvasRenderingContext2D, plot: Plot, d: ChartLayers, c: ChartColors) {
  const { box, px, t0, t1 } = plot;
  const rail = box.y0 - 7;
  // The flights already show where takeoff and landing are; without them the lines do.
  const allLines = !d.bands?.length;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.line2;
  ctx.setLineDash([2, 3]);
  for (const m of d.markers ?? []) {
    if (m.t < t0 || m.t > t1) continue;
    if (allLines || m.label === 'A') {
      const x = Math.round(px(m.t)) + 0.5;
      segment(ctx, x, box.y0, x, box.y1);
    }
  }
  ctx.restore();
  for (const m of d.markers ?? []) {
    if (m.t >= t0 && m.t <= t1) drawGlyph(ctx, m.label, px(m.t), rail, c);
  }
}

/**
 * The cursor layer, redrawn on every playhead update: the playhead (snapped to a sample, with a dot on each curve),
 * and under the pointer a lighter line with its position named on the axis. `at` and `hover` are in x units.
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  d: Pick<ChartLayers, 'time' | 'series' | 'axis'>,
  c: ChartColors,
  at: number | null,
  hover: number | null,
) {
  if (d.time.length === 0) return;
  const { box, px, py } = plot;
  const mark = (x: number, dots: boolean, alpha: number) => {
    const i = indexAt(d.time, x);
    const cx = px(d.time[i]);
    const lx = Math.round(cx) + 0.5;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.text;
    segment(ctx, lx, box.y0, lx, box.y1);
    ctx.globalAlpha = 1;
    if (dots)
      d.series.forEach((s, k) => {
        const v = s.values[i];
        if (!Number.isFinite(v)) return;
        ctx.beginPath();
        ctx.arc(cx, py(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = c.series[k];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.surface;
        ctx.stroke();
      });
    return { i, cx };
  };
  if (at !== null) mark(at, hover === null, 0.8);
  if (hover === null) return;
  const { i, cx } = mark(hover, true, 0.4);
  const label = d.axis ? d.axis.tick(d.time[i]) : timeLabel(d.time[i]);
  ctx.font = figureFont(c, 11, 600);
  const w = ctx.measureText(label).width + 12;
  const x = clamp(cx - w / 2, 0, plot.width - w);
  roundedRect(ctx, x, box.y1 + 4, w, 17, 8.5);
  ctx.fillStyle = c.text;
  ctx.fill();
  ctx.fillStyle = c.surface;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, box.y1 + 4 + 8.5);
}
