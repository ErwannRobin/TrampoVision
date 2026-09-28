import { useEffect, useRef, useState } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { niceTicks } from './Chart';
import { Playhead, usePlayheadTime } from './playhead';
import { cssVar, useThemeVersion } from './theme';

interface Props {
  result: AnalysisResult;
  playhead: Playhead;
  height?: number;
}

/** Center-of-mass path in the image plane (horizontal offset vs. height), equal axis scales. */
export function TrajectoryPlot({ result, playhead, height = 330 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const theme = useThemeVersion();
  const time = usePlayheadTime(playhead);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { comX, height: h, meta } = result;
    const xs = new Float64Array(meta.count).fill(NaN);
    const firstX = comX.find(Number.isFinite) ?? 0;
    for (let i = 0; i < meta.count; i++) xs[i] = (comX[i] - firstX) / meta.pixelsPerMeter;

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < meta.count; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(h[i])) continue;
      x0 = Math.min(x0, xs[i]);
      x1 = Math.max(x1, xs[i]);
      y0 = Math.min(y0, h[i]);
      y1 = Math.max(y1, h[i]);
    }
    if (!Number.isFinite(x0)) {
      ctx.fillStyle = cssVar('--text-2');
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('No trajectory (scale could not be estimated)', 12, 24);
      return;
    }
    // Keep at least 1 m of range so a tiny wobble isn't blown up, and use the same scale on both axes.
    const rx = Math.max(x1 - x0, 1);
    const ry = Math.max(y1 - y0, 1);
    const m = { l: 40, r: 12, t: 10, b: 22 };
    const scale = Math.min((width - m.l - m.r) / rx, (height - m.t - m.b) / ry);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const X = (v: number) => m.l + (width - m.l - m.r) / 2 + (v - cx) * scale;
    const Y = (v: number) => m.t + (height - m.t - m.b) / 2 - (v - cy) * scale;

    const grid = cssVar('--grid');
    const text = cssVar('--text-2');
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const vTop = cy + (Y(cy) - m.t) / scale;
    const vBot = cy - (height - m.b - Y(cy)) / scale;
    for (const v of niceTicks(vBot, vTop, 4)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(m.l, y);
      ctx.lineTo(width - m.r, y);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(`${Number(v.toFixed(2))}`, m.l - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const hLeft = cx - (X(cx) - m.l) / scale;
    const hRight = cx + (width - m.r - X(cx)) / scale;
    for (const v of niceTicks(hLeft, hRight, Math.max(3, Math.floor(width / 90)))) {
      const x = Math.round(X(v)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(x, m.t);
      ctx.lineTo(x, height - m.b);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(`${Number(v.toFixed(2))}`, x, height - m.b + 5);
    }

    const cur = sampleIndexAt(meta, time);
    const path = (from: number, to: number) => {
      ctx.beginPath();
      let pen = false;
      for (let i = from; i <= to; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(h[i])) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(X(xs[i]), Y(h[i]));
        else ctx.moveTo(X(xs[i]), Y(h[i]));
        pen = true;
      }
    };
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cssVar('--series-1');
    ctx.globalAlpha = 0.3;
    path(0, meta.count - 1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    path(0, cur);
    ctx.stroke();
    if (Number.isFinite(xs[cur]) && Number.isFinite(h[cur])) {
      ctx.beginPath();
      ctx.arc(X(xs[cur]), Y(h[cur]), 5, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--series-1');
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssVar('--surface');
      ctx.stroke();
    }
  }, [result, width, height, theme, time]);

  return (
    <figure className="chart tall">
      <figcaption>
        <span className="chart-title">
          Center-of-mass path <span className="muted">(m, x offset vs. height)</span>
        </span>
      </figcaption>
      <div ref={wrapRef} className="chart-body" style={{ height }}>
        <canvas ref={canvasRef} style={{ width, height }} />
      </div>
    </figure>
  );
}
