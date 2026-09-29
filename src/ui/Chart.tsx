import { useEffect, useRef, useState } from 'react';
import { Playhead, usePlayheadTime } from './playhead';
import { cssVar, useThemeVersion } from './theme';

export interface ChartSeries {
  label: string;
  values: Float64Array;
  /** CSS variable holding the series color, e.g. "--series-1". */
  color: string;
}

export interface ChartMarker {
  /** Time in seconds. */
  t: number;
  label: string;
}

export interface ChartBand {
  from: number;
  to: number;
}

export interface ChartGuide {
  /** y value of a dashed horizontal reference line. */
  value: number;
  label?: string;
}

/** For charts whose x axis is not the video time (e.g. normalized jump time 0..1). */
export interface ChartAxis {
  /** Playhead seconds -> x. */
  toX: (seconds: number) => number;
  /** x -> playhead seconds (a click on the chart seeks there). */
  toSeconds: (x: number) => number;
  /** Tick label for an x value. */
  tick: (x: number) => string;
}

interface Props {
  title: string;
  unit: string;
  time: Float64Array;
  series: ChartSeries[];
  playhead: Playhead;
  /** Samples with confidence below 0.5 are shaded. */
  confidence?: Float64Array;
  decimals?: number;
  zeroLine?: boolean;
  height?: number;
  /** Fixed y range (e.g. [0, 1]); otherwise the range follows the data. */
  yDomain?: [number, number];
  /** Smallest y range to show, so measurement noise isn't blown up to full height. */
  minSpan?: number;
  /** Lift the pen when consecutive samples differ by more than this (e.g. 180 for wrapped angles). */
  breakOnJump?: number;
  /** Labelled vertical lines (events such as takeoff / apex / landing). */
  markers?: ChartMarker[];
  /** Shaded time ranges (e.g. the flights). */
  bands?: ChartBand[];
  /** Dashed horizontal reference lines; they also widen the y range. */
  guides?: ChartGuide[];
  /** `time`, `markers` and `bands` are then in x units, not seconds. */
  axis?: ChartAxis;
}

const M = { left: 46, right: 12, top: 8, bottom: 20 };

export function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function domain(series: ChartSeries[], zeroLine: boolean, minSpan: number, guides: ChartGuide[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (const v of s.values)
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  if (!Number.isFinite(lo)) return [0, 1];
  for (const g of guides) {
    lo = Math.min(lo, g.value);
    hi = Math.max(hi, g.value);
  }
  if (zeroLine) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < minSpan) {
    const c = (hi + lo) / 2;
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

function indexAt(time: Float64Array, t: number): number {
  if (time.length < 2) return 0;
  const dt = (time[time.length - 1] - time[0]) / (time.length - 1);
  return Math.min(Math.max(Math.round((t - time[0]) / dt), 0), time.length - 1);
}

export function Chart({
  title,
  unit,
  time,
  series,
  playhead,
  confidence,
  decimals = 1,
  zeroLine = false,
  height = 150,
  yDomain,
  minSpan = 1e-6,
  breakOnJump,
  markers,
  bands,
  guides,
  axis,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const theme = useThemeVersion();
  const playTime = usePlayheadTime(playhead);
  const playX = axis ? axis.toX(playTime) : playTime;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const [lo, hi] = yDomain ?? domain(series, zeroLine, minSpan, guides ?? []);
  const t0 = time[0] ?? 0;
  const t1 = time[time.length - 1] ?? 1;
  const px = (t: number) => M.left + ((t - t0) / (t1 - t0 || 1)) * (width - M.left - M.right);
  const py = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (height - M.top - M.bottom);

  const setup = (c: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  };

  // Static layer: bands, grid, axes, lines.
  useEffect(() => {
    const c = plotRef.current;
    if (!c) return;
    const ctx = setup(c);
    const grid = cssVar('--grid');
    const text = cssVar('--text-2');
    ctx.font = '11px system-ui, sans-serif';

    if (bands?.length) {
      ctx.fillStyle = cssVar('--flight-band');
      for (const b of bands) {
        const x0 = px(Math.max(b.from, t0));
        const x1 = px(Math.min(b.to, t1));
        if (x1 > x0) ctx.fillRect(x0, M.top, x1 - x0, height - M.top - M.bottom);
      }
    }

    if (confidence) {
      ctx.fillStyle = cssVar('--band');
      const w = (width - M.left - M.right) / Math.max(1, time.length - 1) || 1;
      for (let i = 0; i < time.length; i++)
        if (!(confidence[i] >= 0.5)) ctx.fillRect(px(time[i]) - w / 2, M.top, w, height - M.top - M.bottom);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const v of niceTicks(lo, hi, 4)) {
      const y = Math.round(py(v)) + 0.5;
      ctx.strokeStyle = v === 0 && zeroLine ? text : grid;
      ctx.beginPath();
      ctx.moveTo(M.left, y);
      ctx.lineTo(width - M.right, y);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(Number(v.toFixed(2)).toString(), M.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(t0, t1, Math.max(3, Math.floor(width / 90)))) {
      ctx.fillStyle = text;
      ctx.fillText(axis ? axis.tick(t) : `${Number(t.toFixed(2))}s`, px(t), height - M.bottom + 5);
    }

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const s of series) {
      ctx.strokeStyle = cssVar(s.color);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < time.length; i++) {
        const v = s.values[i];
        if (
          !Number.isFinite(v) ||
          (breakOnJump !== undefined && i > 0 && Math.abs(v - s.values[i - 1]) > breakOnJump)
        ) {
          pen = false;
          if (!Number.isFinite(v)) continue;
        }
        if (pen) ctx.lineTo(px(time[i]), py(v));
        else ctx.moveTo(px(time[i]), py(v));
        pen = true;
      }
      ctx.stroke();
    }

    if (guides?.length) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = text;
      ctx.fillStyle = text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      for (const g of guides) {
        if (g.value < lo || g.value > hi) continue;
        const y = Math.round(py(g.value)) + 0.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(M.left, y);
        ctx.lineTo(width - M.right, y);
        ctx.stroke();
        if (g.label) ctx.fillText(g.label, width - M.right - 2, y - 2);
      }
      ctx.restore();
    }

    if (markers?.length) {
      ctx.save();
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const m of markers) {
        if (m.t < t0 || m.t > t1) continue;
        const x = Math.round(px(m.t)) + 0.5;
        ctx.strokeStyle = text;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(x, M.top);
        ctx.lineTo(x, height - M.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = text;
        ctx.fillText(m.label, x, M.top + 1);
      }
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, series, confidence, width, height, theme, lo, hi, markers, bands, guides, axis]);

  // Cursor layer: playhead line + markers, and hover crosshair.
  useEffect(() => {
    const c = cursorRef.current;
    if (!c) return;
    const ctx = setup(c);
    const draw = (t: number, alpha: number, markers: boolean) => {
      if (axis && (t < t0 || t > t1)) return; // the playhead is outside this chart's range
      const x = Math.round(px(Math.min(Math.max(t, t0), t1))) + 0.5;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = cssVar('--text-2');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, M.top);
      ctx.lineTo(x, height - M.bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (!markers) return;
      const i = indexAt(time, t);
      for (const s of series) {
        if (!Number.isFinite(s.values[i])) continue;
        ctx.beginPath();
        ctx.arc(x, py(s.values[i]), 4, 0, Math.PI * 2);
        ctx.fillStyle = cssVar(s.color);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssVar('--surface');
        ctx.stroke();
      }
    };
    draw(playX, 0.9, hover === null);
    if (hover !== null) draw(hover, 0.5, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playX, hover, time, series, width, height, theme, lo, hi]);

  /** x (chart units) under the pointer. */
  const timeFromEvent = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left - M.left) / (rect.width - M.left - M.right);
    return t0 + Math.min(Math.max(f, 0), 1) * (t1 - t0);
  };

  const readoutTime = hover ?? playX;
  const ri = indexAt(time, readoutTime);
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(decimals) : '–');

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">
          {title} <span className="muted">({unit})</span>
        </span>
        <span className="legend mono">
          {series.map((s) => (
            <span key={s.label} className="legend-item">
              <i className="swatch" style={{ background: `var(${s.color})` }} />
              {series.length > 1 && <span className="muted">{s.label} </span>}
              {fmt(s.values[ri])}
            </span>
          ))}
        </span>
      </figcaption>
      <div ref={wrapRef} className="chart-body" style={{ height }}>
        <canvas ref={plotRef} style={{ width, height }} />
        <canvas
          ref={cursorRef}
          style={{ width, height, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            playhead.seek(axis ? axis.toSeconds(timeFromEvent(e)) : timeFromEvent(e));
          }}
          onPointerMove={(e) => {
            const t = timeFromEvent(e);
            setHover(t);
            if (dragging.current) playhead.seek(axis ? axis.toSeconds(t) : t);
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => setHover(null)}
        />
      </div>
    </figure>
  );
}
