import type { AnalysisResult } from '../../analysis/types';
import type { SkillAnalysis } from '../../skills/analyzeSkills';
import { formatDecimal } from '../../i18n/core';
import { fmt } from '../format';
import { confidenceTier } from '../insights';
import { cssVar } from '../theme';
import { clamp, flightSpan, lowConfidenceSpans, rulerTicks, timeToX, type PlotBox, type TimeWindow } from './geometry';

/** Horizontal room around the time axis, and the heights of the strip. */
export const PAD_X = 14;
export const timelineHeight = (compact: boolean) => (compact ? 104 : 136);

/** The theme colors the strip reads; read again whenever the theme changes. */
export interface TimelineColors {
  text: string;
  text2: string;
  text3: string;
  line: string;
  line2: string;
  panel: string;
  panel2: string;
  lift: string;
  drop: string;
  goldFill: string;
  inverse: string;
}

export function readColors(): TimelineColors {
  return {
    text: cssVar('--text'),
    text2: cssVar('--text-2'),
    text3: cssVar('--text-3'),
    line: cssVar('--line'),
    line2: cssVar('--line-2'),
    panel: cssVar('--panel'),
    panel2: cssVar('--panel-2'),
    lift: cssVar('--lift'),
    drop: cssVar('--drop'),
    goldFill: cssVar('--gold-fill'),
    inverse: cssVar('--inverse'),
  };
}

export interface TimelineScene {
  result: AnalysisResult;
  skills: SkillAnalysis | null;
  selected: number | null;
  win: TimeWindow;
  plot: PlotBox;
  /** How much of the strip is drawn, 0 to 1, left to right: the strip draws itself in when an analysis arrives. */
  reveal: number;
  compact: boolean;
  colors: TimelineColors;
  /** Where the routine starts, seconds; null when it has no start. */
  routineStartS: number | null;
}

const TAU = Math.PI * 2;

interface Lane {
  top: number;
  bottom: number;
}

export function laneOf(height: number, compact: boolean): Lane {
  return { top: compact ? 26 : 32, bottom: height - (compact ? 22 : 26) };
}

/** #rrggbb to rgba(); anything else is returned as it is. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, size: number, condensed: boolean) {
  ctx.font = `${weight} ${size}px "Archivo Variable", system-ui, -apple-system, "Segoe UI", sans-serif`;
  // Canvas takes the width as a keyword; browsers without it keep the normal width.
  (ctx as unknown as { fontStretch?: string }).fontStretch = condensed ? 'condensed' : 'normal';
}

/** The height range of a clip, so the vertical scale holds still while the window moves. */
const rangeCache = new WeakMap<AnalysisResult, { lo: number; hi: number }>();
function heightRange(result: AnalysisResult): { lo: number; hi: number } {
  const cached = rangeCache.get(result);
  if (cached) return cached;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of result.height) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  // With the bed marked, zero is the bed: keep it on the baseline even if the clip never comes down to it.
  if (result.meta.heightReference === 'bed') lo = Math.min(lo, 0);
  const range = { lo, hi: Math.max(hi, lo + 0.5) };
  rangeCache.set(result, range);
  return range;
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  result: AnalysisResult,
  from: number,
  to: number,
  x: (i: number) => number,
  y: (v: number) => number,
) {
  let pen = false;
  for (let i = from; i <= to; i++) {
    const v = result.height[i];
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x(i), y(v));
    else ctx.moveTo(x(i), y(v));
    pen = true;
  }
}

function triangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pointing: 'up' | 'down',
  size: number,
  colors: TimelineColors,
) {
  const s = pointing === 'up' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y + s * size * 0.9);
  ctx.lineTo(x + size * 0.9, y - s * size * 0.6);
  ctx.lineTo(x - size * 0.9, y - s * size * 0.6);
  ctx.closePath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.panel;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.fill();
}

function apexDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colors: TimelineColors) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = colors.goldFill;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = colors.panel;
  ctx.stroke();
}

interface ChipStyle {
  selected: boolean;
  dashed: boolean;
  compact: boolean;
}

/** The jump number and, when there is room, its skill. Filled for the selected jump; dashed when the skill is not sure. */
function chip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  room: number,
  n: number,
  label: string,
  style: ChipStyle,
  colors: TimelineColors,
) {
  const h = style.compact ? 16 : 18;
  const size = style.compact ? 10.5 : 11.5;
  const pad = 6;
  setFont(ctx, 700, size, true);
  const number = String(n);
  const numberW = ctx.measureText(number).width;
  setFont(ctx, 550, size, false);
  const gap = 5;
  let text = label;
  const fixed = pad * 2 + numberW + gap;
  let width = fixed + ctx.measureText(text).width;
  if (!text || width > room) {
    // Shorten the label while it still says something, then leave it out.
    while (text.length > 3 && fixed + ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
    if (text.length > 3 && fixed + ctx.measureText(`${text}…`).width <= room) text = `${text}…`;
    else text = '';
    width = text ? fixed + ctx.measureText(text).width : Math.max(h, pad * 2 + numberW);
  }
  if (!style.selected && width > room && room < h) return;

  ctx.beginPath();
  ctx.roundRect(x, y, width, h, h / 2);
  if (style.selected) {
    ctx.fillStyle = colors.text;
    ctx.fill();
  } else {
    ctx.fillStyle = colors.panel;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line2;
    if (style.dashed) ctx.setLineDash([3, 2.5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const ink = style.selected ? colors.inverse : colors.text;
  setFont(ctx, 700, size, true);
  ctx.fillStyle = ink;
  const cy = y + h / 2 + 0.5;
  if (text) {
    ctx.fillText(number, x + pad, cy);
    setFont(ctx, 550, size, false);
    ctx.fillStyle = style.selected ? colors.inverse : colors.text2;
    ctx.fillText(text, x + pad + numberW + gap, cy);
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(number, x + width / 2, cy);
  }
}

/** The strip: height of the center of mass across the clip, flights as colored arches, events, jump chips, ruler. */
export function drawStatic(ctx: CanvasRenderingContext2D, w: number, h: number, scene: TimelineScene) {
  const { result, skills, selected, win, plot, compact, colors } = scene;
  ctx.clearRect(0, 0, w, h);
  const count = result.meta.count;
  if (count === 0) return;

  const lane = laneOf(h, compact);
  const { lo, hi } = heightRange(result);
  const usable = lane.bottom - lane.top - 8;
  const y = (v: number) => lane.bottom - 2 - ((v - lo) / (hi - lo)) * usable;
  const x = (i: number) => timeToX(result.time[i], win, plot);
  const tx = (t: number) => timeToX(t, win, plot);
  const clip: TimeWindow = { t0: result.time[0], t1: result.time[count - 1] };
  const first = Math.max(0, Math.floor((win.t0 - clip.t0) * result.meta.fps) - 1);
  const last = Math.min(count - 1, Math.ceil((win.t1 - clip.t0) * result.meta.fps) + 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plot.left + scene.reveal * plot.width + PAD_X * scene.reveal, h);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The selected jump sits on a faint capsule.
  const cycles = result.jumps.cycles;
  const sel = selected !== null ? cycles[selected] : undefined;
  if (sel) {
    const span = flightSpan(sel, clip);
    const x0 = tx(span.start) - 5;
    const x1 = tx(span.end) + 5;
    ctx.beginPath();
    ctx.roundRect(x0, lane.top - 6, x1 - x0, lane.bottom - lane.top + 12, 10);
    ctx.fillStyle = colors.panel2;
    ctx.fill();
  }

  // The bed.
  ctx.beginPath();
  ctx.moveTo(plot.left, lane.bottom + 0.5);
  ctx.lineTo(plot.left + plot.width, lane.bottom + 0.5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.line2;
  ctx.stroke();

  // Where the routine starts: a dashed line with a pennant, under everything else.
  if (scene.routineStartS !== null) {
    const rx = Math.round(tx(scene.routineStartS)) + 0.5;
    if (rx >= plot.left - 1 && rx <= plot.left + plot.width + 1) {
      const top = lane.top - 9;
      ctx.beginPath();
      ctx.moveTo(rx, top);
      ctx.lineTo(rx, lane.bottom);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = colors.text2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(rx, top);
      ctx.lineTo(rx + 9, top + 3.5);
      ctx.lineTo(rx, top + 7);
      ctx.closePath();
      ctx.fillStyle = colors.text2;
      ctx.fill();
    }
  }

  // Where the pose was unclear: hatched along the bed. Solid means sure, hatched means not sure.
  const unclear = lowConfidenceSpans(result.time, result.confidence);
  if (unclear.length) {
    ctx.save();
    ctx.beginPath();
    for (const s of unclear) {
      const x0 = clamp(tx(s.from), plot.left, plot.left + plot.width);
      const x1 = clamp(tx(s.to), plot.left, plot.left + plot.width);
      if (x1 > x0) ctx.rect(x0, lane.bottom - 9, x1 - x0, 9);
    }
    ctx.clip();
    ctx.beginPath();
    for (let hx = plot.left - 12; hx < plot.left + plot.width + 12; hx += 5) {
      ctx.moveTo(hx, lane.bottom);
      ctx.lineTo(hx + 9, lane.bottom - 9);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.text3;
    ctx.stroke();
    ctx.restore();
  }

  // The whole clip as a quiet line: the time on the bed between the flights.
  ctx.beginPath();
  tracePath(ctx, result, first, last, x, y);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = colors.text3;
  ctx.stroke();

  // Flights: rising in lift, falling in drop, with a soft fill under the arch.
  for (const c of cycles) {
    const span = flightSpan(c, clip);
    if (tx(span.end) < plot.left - 2 || tx(span.start) > plot.left + plot.width + 2) continue;
    const strong = selected === null || selected === c.index;
    const iStart = c.takeoff ?? 0;
    const iEnd = c.landing ?? count - 1;
    const iApex = clamp(c.apex, iStart, iEnd);
    const halves: [number, number, string][] = [
      [iStart, iApex, colors.lift],
      [iApex, iEnd, colors.drop],
    ];
    for (const [from, to, color] of halves) {
      const g = ctx.createLinearGradient(0, y(c.apexHeightM), 0, lane.bottom);
      g.addColorStop(0, withAlpha(color, strong ? 0.34 : 0.16));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.beginPath();
      tracePath(ctx, result, from, to, x, y);
      ctx.lineTo(x(to), lane.bottom);
      ctx.lineTo(x(from), lane.bottom);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    for (const [from, to, color] of halves) {
      ctx.beginPath();
      tracePath(ctx, result, from, to, x, y);
      ctx.lineWidth = selected === c.index ? 2.6 : 1.9;
      ctx.strokeStyle = withAlpha(color, strong ? 1 : 0.62);
      ctx.stroke();
    }
  }

  // Takeoff (up), landing (down) and apex (the gold dot of the center of mass).
  for (const c of cycles) {
    const isSel = selected === c.index;
    const size = isSel ? 5.4 : 4.2;
    if (c.takeoffTimeS !== null && c.takeoffHeightM !== null)
      triangle(ctx, tx(c.takeoffTimeS), y(c.takeoffHeightM), 'up', size, colors);
    if (c.landingTimeS !== null && c.landingHeightM !== null)
      triangle(ctx, tx(c.landingTimeS), y(c.landingHeightM), 'down', size, colors);
    apexDot(ctx, tx(c.apexTimeS), y(c.apexHeightM), isSel ? 5.4 : 4, colors);
  }

  // The height of the selected jump, above its apex.
  if (sel && Number.isFinite(sel.apexHeightM)) {
    const ax = tx(sel.apexTimeS);
    const ay = y(sel.apexHeightM);
    setFont(ctx, 600, compact ? 11 : 12, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.fillText(`${fmt(sel.apexHeightM, 2)} m`, ax, Math.max(ay - 11, lane.top - 2 + 8));
  }

  // Jump chips above the arches.
  const chipY = compact ? 2 : 3;
  for (const c of cycles) {
    const span = flightSpan(c, clip);
    const x0 = Math.max(tx(span.start), plot.left);
    const x1 = Math.min(tx(span.end), plot.left + plot.width);
    if (x1 - x0 < 8) continue;
    const prediction = skills?.jumps[c.index]?.prediction;
    const tier = prediction && skills ? confidenceTier(prediction, skills.config.minConfidence) : 'none';
    const label = !prediction ? '' : prediction.skill === 'unclassified' ? '?' : prediction.label;
    chip(
      ctx,
      x0 + 1,
      chipY,
      x1 - x0 - 2,
      c.index + 1,
      label,
      { selected: selected === c.index, dashed: !!prediction && tier !== 'high', compact },
      colors,
    );
  }

  // Ruler.
  const { times } = rulerTicks(win, plot.width, compact ? 56 : 68);
  setFont(ctx, 500, compact ? 10 : 10.5, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.text3;
  ctx.strokeStyle = colors.line2;
  ctx.lineWidth = 1;
  for (const t of times) {
    const px = Math.round(tx(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, lane.bottom + 1);
    ctx.lineTo(px, lane.bottom + 5);
    ctx.stroke();
    ctx.fillText(`${formatDecimal(Number(t.toFixed(2)), 2)} s`, px, lane.bottom + 8);
  }
  ctx.restore();
}

/** The playhead, the center of mass at the playhead, and a ghost line under the pointer. */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: TimelineScene,
  time: number,
  hoverTime: number | null,
) {
  ctx.clearRect(0, 0, w, h);
  const { result, win, plot, compact, colors } = scene;
  if (result.meta.count === 0) return;
  const lane = laneOf(h, compact);
  const tx = (t: number) => timeToX(t, win, plot);

  if (hoverTime !== null && hoverTime >= win.t0 && hoverTime <= win.t1) {
    const hx = Math.round(tx(hoverTime)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(hx, lane.top - 8);
    ctx.lineTo(hx, lane.bottom);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = colors.text;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (time < win.t0 || time > win.t1) return;
  const px = Math.round(tx(time)) + 0.5;
  ctx.beginPath();
  ctx.moveTo(px, lane.top - 8);
  ctx.lineTo(px, lane.bottom);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.text;
  ctx.stroke();

  // The same gold dot as on the video, riding the curve.
  const { lo, hi } = heightRange(result);
  const i = clamp(Math.round((time - result.time[0]) * result.meta.fps), 0, result.meta.count - 1);
  const v = result.height[i];
  if (Number.isFinite(v)) {
    const cy = lane.bottom - 2 - ((v - lo) / (hi - lo)) * (lane.bottom - lane.top - 8);
    ctx.beginPath();
    ctx.arc(px, cy, 4.2, 0, TAU);
    ctx.fillStyle = colors.goldFill;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colors.text;
    ctx.stroke();
  }

  // The handle, where the line meets the bed.
  ctx.beginPath();
  ctx.arc(px, lane.bottom + 0.5, 5.2, 0, TAU);
  ctx.fillStyle = colors.text;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.panel;
  ctx.stroke();
}
