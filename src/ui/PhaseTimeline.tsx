import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { Playhead, usePlayheadTime } from './playhead';
import { cssVar, useThemeVersion } from './theme';

interface Props {
  result: AnalysisResult;
  skills: SkillAnalysis | null;
  playhead: Playhead;
  selected: number | null;
  onSelect: (jump: number) => void;
}

const HEIGHT = 84;
const PAD = 8;
const TOP = 16; // room for the skill label
const BOTTOM = 14; // room for the T / A / L letters

/**
 * The whole clip on one strip: the flights split into ascent and descent, takeoff / apex / landing marks,
 * the predicted skill of each jump, and the center-of-mass height behind it. Click = seek (and select the jump).
 */
export function PhaseTimeline({ result, skills, playhead, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const theme = useThemeVersion();
  const time = usePlayheadTime(playhead);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const t0 = result.time[0] ?? 0;
  const t1 = result.time[result.time.length - 1] ?? 1;
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0 || 1)) * (width - 2 * PAD);
  const tOf = (px: number) => t0 + ((px - PAD) / (width - 2 * PAD)) * (t1 - t0);

  const setup = (c: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    return ctx;
  };

  useEffect(() => {
    const c = plotRef.current;
    if (!c) return;
    const ctx = setup(c);
    const text = cssVar('--text-2');
    const ink = cssVar('--text');
    const up = cssVar('--series-1');
    const down = cssVar('--series-2');
    const lane = { top: TOP, bottom: HEIGHT - BOTTOM };
    ctx.font = '600 11px system-ui, sans-serif';

    // Lane background.
    ctx.fillStyle = cssVar('--grid');
    ctx.fillRect(PAD, lane.top, width - 2 * PAD, lane.bottom - lane.top);

    // Center-of-mass height, faint, so the phases can be read against the motion.
    const h = Array.from(result.height).filter(Number.isFinite);
    if (h.length) {
      const lo = Math.min(...h);
      const hi = Math.max(...h);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < result.time.length; i++) {
        const v = result.height[i];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const y = lane.bottom - 2 - ((v - lo) / (hi - lo || 1)) * (lane.bottom - lane.top - 4);
        if (pen) ctx.lineTo(x(result.time[i]), y);
        else ctx.moveTo(x(result.time[i]), y);
        pen = true;
      }
      ctx.strokeStyle = text;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const cycle of result.jumps.cycles) {
      const start = cycle.takeoffTimeS ?? t0;
      const end = cycle.landingTimeS ?? t1;
      const apex = cycle.apexTimeS;
      // Ascent (takeoff to apex) and descent (apex to landing).
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = up;
      ctx.fillRect(x(start), lane.top, x(apex) - x(start), lane.bottom - lane.top);
      ctx.fillStyle = down;
      ctx.fillRect(x(apex), lane.top, x(end) - x(apex), lane.bottom - lane.top);
      ctx.globalAlpha = 1;

      if (selected === cycle.index) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(x(start) + 1, lane.top + 1, x(end) - x(start) - 2, lane.bottom - lane.top - 2);
      }

      // Event marks with letters.
      const mark = (t: number | null, letter: string) => {
        if (t === null) return;
        const px = Math.round(x(t)) + 0.5;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, lane.top);
        ctx.lineTo(px, lane.bottom + 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(letter, px, lane.bottom + 2);
      };
      mark(cycle.takeoffTimeS, 'T');
      mark(apex, 'A');
      mark(cycle.landingTimeS, 'L');

      // Label: jump number and predicted skill.
      const p = skills?.jumps[cycle.index]?.prediction;
      const label = `${cycle.index + 1}${p ? ` · ${p.skill === 'unclassified' && p.confidence === 0 ? 'not classified' : `${p.label} ${Math.round(p.confidence * 100)}%`}` : ''}`;
      const span = x(end) - x(start);
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let shown = label;
      while (shown.length > 2 && ctx.measureText(shown).width > span - 4) shown = shown.slice(0, -2) + '…';
      if (ctx.measureText(shown).width <= span - 2) ctx.fillText(shown, x(start) + 3, 1);
      else ctx.fillText(String(cycle.index + 1), x(start) + 3, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, skills, selected, width, theme]);

  useEffect(() => {
    const c = cursorRef.current;
    if (!c) return;
    const ctx = setup(c);
    const px = Math.round(x(Math.min(Math.max(time, t0), t1))) + 0.5;
    ctx.strokeStyle = cssVar('--text');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 2);
    ctx.lineTo(px, HEIGHT - 2);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, width, theme, t0, t1]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.min(Math.max(tOf(e.clientX - rect.left), t0), t1);
    const hit = result.jumps.cycles.find((c) => t >= (c.takeoffTimeS ?? t0) && t <= (c.landingTimeS ?? t1));
    if (hit) onSelect(hit.index);
    playhead.seek(t);
  };

  return (
    <div className="timeline">
      <div className="timeline-legend muted">
        <span>
          <i className="swatch" style={{ background: 'var(--series-1)', opacity: 0.5 }} /> ascent
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--series-2)', opacity: 0.5 }} /> descent
        </span>
        <span>T takeoff · A apex · L landing</span>
        <span>line = center-of-mass height</span>
      </div>
      <div ref={wrapRef} className="timeline-body" style={{ height: HEIGHT }}>
        <canvas ref={plotRef} style={{ width, height: HEIGHT }} />
        <canvas
          ref={cursorRef}
          style={{ width, height: HEIGHT, cursor: 'pointer', touchAction: 'none' }}
          onPointerDown={pick}
        />
      </div>
    </div>
  );
}
