import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { JUMP_PHASES } from '../analysis/jumpCycles';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { t, useLocale } from '../i18n';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { fmt, timecode } from './format';
import { skillName } from './insights';
import { useElementSize, useReducedMotion } from './hooks';
import { Button, IconButton, Segmented } from './kit';
import type { Playhead } from './playhead';
import { useThemeVersion } from './theme';
import {
  drawCursor,
  drawStatic,
  PAD_X,
  readColors,
  timelineHeight,
  type TimelineColors,
  type TimelineScene,
} from './timeline/draw';
import {
  clamp,
  flightSpan,
  jumpAt,
  jumpWindow,
  mixWindows,
  nearestEvent,
  timelineEvents,
  xToTime,
  windowsClose,
  type EventKind,
  type TimeWindow,
} from './timeline/geometry';

export interface TimelineProps {
  result: AnalysisResult;
  skills: SkillAnalysis | null;
  playhead: Playhead;
  /** Selected jump, 0-based; null when the clip has no jump. */
  selected: number | null;
  /** Select a jump only: the timeline moves the playhead itself. */
  onSelect: (jump: number) => void;
  /** Previous / next jump: select it and move the playhead to its takeoff. */
  onStepJump: (delta: -1 | 1) => void;
  /** Play the selected jump with a little run-up and landing. */
  onPlayJump: () => void;
  loop: boolean;
  onLoop: (loop: boolean) => void;
}

/** The strip draws itself in once when an analysis arrives; the zoom eases toward its window. */
const REVEAL_MS = 700;
const ZOOM_EASE_MS = 90;

const eventText = (kind: EventKind): string => t(`phase.${kind}`);

const zoomOptions = () =>
  [
    { value: 'clip', label: t('tl.zoomClip'), title: t('tl.zoomClipTitle') },
    { value: 'jump', label: t('tl.zoomJump'), title: t('tl.zoomJumpTitle') },
  ] as const;

function prepare(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function Glyph({ pointing }: { pointing: 'up' | 'down' }) {
  return (
    <svg className="tl__glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d={pointing === 'up' ? 'M6 1.5 10.8 10H1.2Z' : 'M6 10.5 1.2 2h9.6Z'} />
    </svg>
  );
}

/**
 * The flights of the clip as one strip under the video: a score of arches, rising in blue and falling in orange, with
 * takeoff, apex and landing marked, a chip per jump, and the playhead. Press or drag to scrub; a press inside a flight
 * also selects that jump. The canvases are painted imperatively so playback never re-renders the component.
 */
export function Timeline({
  result,
  skills,
  playhead,
  selected,
  onSelect,
  onStepJump,
  onPlayJump,
  loop,
  onLoop,
}: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrapRef);
  const theme = useThemeVersion();
  const locale = useLocale();
  const reduced = useReducedMotion();
  const compact = width > 0 && width < 640;
  const height = timelineHeight(compact);
  const [zoom, setZoom] = useState<'clip' | 'jump'>('clip');
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const cycles = result.jumps.cycles;
  const count = result.meta.count;
  const clip = useMemo<TimeWindow>(
    () => ({ t0: result.time[0] ?? 0, t1: result.time[count - 1] ?? 1 }),
    [result, count],
  );
  const plot = useMemo(() => ({ left: PAD_X, width: Math.max(1, width - 2 * PAD_X) }), [width]);
  const events = useMemo(() => timelineEvents(cycles), [cycles]);
  const selectedCycle = selected !== null ? cycles[selected] : undefined;
  const target = useMemo<TimeWindow>(
    () => (zoom === 'jump' && selectedCycle ? jumpWindow(flightSpan(selectedCycle, clip), clip) : clip),
    [zoom, selectedCycle, clip],
  );

  const winRef = useRef<TimeWindow>(target);
  const revealRef = useRef(1);
  const colorsRef = useRef<TimelineColors | null>(null);
  const hoverRef = useRef<number | null>(null);
  const dragging = useRef(false);
  const latest = useRef({ result, skills, selected, plot, compact, width, height, cycles, clip });
  latest.current = { result, skills, selected, plot, compact, width, height, cycles, clip };

  const scene = useCallback((): TimelineScene => {
    const l = latest.current;
    colorsRef.current ??= readColors();
    return {
      result: l.result,
      skills: l.skills,
      selected: l.selected,
      win: winRef.current,
      plot: l.plot,
      reveal: revealRef.current,
      compact: l.compact,
      colors: colorsRef.current,
    };
  }, []);

  const paintStatic = useCallback(() => {
    const canvas = staticRef.current;
    const { width: w, height: h } = latest.current;
    if (!canvas || w === 0) return;
    const ctx = prepare(canvas, w, h);
    if (ctx) drawStatic(ctx, w, h, scene());
  }, [scene]);

  const paintCursor = useCallback(() => {
    const canvas = cursorRef.current;
    const { width: w, height: h } = latest.current;
    if (!canvas || w === 0) return;
    const ctx = prepare(canvas, w, h);
    if (ctx) drawCursor(ctx, w, h, scene(), playhead.getSnapshot(), hoverRef.current);
  }, [scene, playhead]);

  // A new theme means new colors.
  useEffect(() => {
    colorsRef.current = readColors();
    paintStatic();
    paintCursor();
  }, [theme, paintStatic, paintCursor]);

  // Everything the strip shows changed without an animation: repaint.
  useEffect(() => {
    paintStatic();
    paintCursor();
  }, [result, skills, selected, width, height, compact, locale, paintStatic, paintCursor]);

  // A new analysis: the window starts on the clip and the strip draws itself in.
  useEffect(() => {
    winRef.current = latest.current.clip;
    if (reduced) {
      revealRef.current = 1;
      paintStatic();
      paintCursor();
      return;
    }
    revealRef.current = 0;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const p = clamp((now - started) / REVEAL_MS, 0, 1);
      revealRef.current = 1 - (1 - p) ** 3;
      paintStatic();
      paintCursor();
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result, reduced, paintStatic, paintCursor]);

  // Zooming to a jump, or back to the clip, eases the window there.
  useEffect(() => {
    if (reduced) {
      winRef.current = target;
      paintStatic();
      paintCursor();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const k = 1 - Math.exp(-(now - last) / ZOOM_EASE_MS);
      last = now;
      winRef.current = windowsClose(winRef.current, target, 1e-3) ? target : mixWindows(winRef.current, target, k);
      paintStatic();
      paintCursor();
      if (winRef.current !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, paintStatic, paintCursor]);

  // The playhead moves: only the cursor layer and the slider's value change.
  useEffect(() => {
    const onTime = () => {
      paintCursor();
      const now = playhead.getSnapshot();
      const slider = cursorRef.current;
      if (slider) {
        slider.setAttribute('aria-valuenow', now.toFixed(2));
        const jump = jumpAt(now, latest.current.cycles, latest.current.clip);
        slider.setAttribute(
          'aria-valuetext',
          jump >= 0 ? t('tl.valueText', { time: timecode(now), n: jump + 1 }) : timecode(now),
        );
      }
    };
    onTime();
    return playhead.subscribe(onTime);
  }, [playhead, paintCursor]);

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    return { x, t: xToTime(x, winRef.current, latest.current.plot) };
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const { t: time } = at(e);
    playhead.seek(time);
    const jump = jumpAt(time, cycles, clip);
    if (jump >= 0) onSelect(jump);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (dragging.current) playhead.seek(p.t);
    if (e.pointerType === 'touch') return;
    hoverRef.current = p.t;
    setHover(p);
    paintCursor();
  };
  const onUp = () => {
    dragging.current = false;
    hoverRef.current = null;
    setHover(null);
    paintCursor();
  };

  const tip = useMemo(() => {
    if (!hover || width === 0) return null;
    const event = nearestEvent(hover.x, events, winRef.current, plot);
    const i = sampleIndexAt(result.meta, event ? event.time : hover.t);
    const jump = event ? event.jump : result.jumps.cycleIndex[i];
    const parts: string[] = [];
    if (event) parts.push(eventText(event.kind));
    else {
      const phase = JUMP_PHASES[result.jumps.phase[i]];
      if (phase && phase !== 'unknown') parts.push(t(`phase.${phase}`));
    }
    const h = result.height[i];
    if (Number.isFinite(h)) parts.push(`${fmt(h, 2)} m`);
    if (jump >= 0) {
      const prediction = skills?.jumps[jump]?.prediction;
      const label = prediction && skillName(prediction);
      parts.push(label ? t('tl.tipJumpLabel', { n: jump + 1, label }) : t('tl.tipJump', { n: jump + 1 }));
    }
    return { time: timecode(event ? event.time : hover.t), parts, right: hover.x > width - 190 };
  }, [hover, width, events, plot, result, skills, locale]); // oxlint-disable-line react-hooks/exhaustive-deps

  const jumpTotal = cycles.length;
  const title =
    selected !== null && jumpTotal > 0 ? t('ins.jumpOf', { n: selected + 1, total: jumpTotal }) : t('coach.noJumps');

  return (
    <div className="tl">
      <div className="tl__head">
        <div className="tl__nav">
          <IconButton
            icon="chevron-left"
            label={t('tl.previous')}
            size="sm"
            disabled={selected === null || selected <= 0}
            onClick={() => onStepJump(-1)}
          />
          <span className="tl__title num" aria-live="polite">
            {title}
          </span>
          <IconButton
            icon="chevron-right"
            label={t('tl.next')}
            size="sm"
            disabled={selected === null || selected >= jumpTotal - 1}
            onClick={() => onStepJump(1)}
          />
        </div>
        <div className="tl__actions">
          <Button variant="secondary" size="sm" icon="play" disabled={selected === null} onClick={onPlayJump}>
            {t('ins.playJump')}
          </Button>
          <IconButton
            icon="loop"
            label={t('tl.loop')}
            size="sm"
            pressed={loop}
            disabled={selected === null}
            onClick={() => onLoop(!loop)}
          />
        </div>
        <div className="tl__zoom">
          <Segmented<'clip' | 'jump'>
            ariaLabel={t('tl.zoom')}
            size="sm"
            value={zoom}
            onChange={setZoom}
            options={zoomOptions().map((o) => ({ ...o, disabled: o.value === 'jump' && selected === null }))}
          />
        </div>
        <ul className="tl__legend" aria-label={t('tl.legend')}>
          <li>
            <Glyph pointing="up" />
            {t('phase.takeoff')}
          </li>
          <li>
            <span className="tl__dot" aria-hidden="true" />
            {t('phase.apex')}
          </li>
          <li>
            <Glyph pointing="down" />
            {t('phase.landing')}
          </li>
        </ul>
      </div>

      <div className="tl__strip" ref={wrapRef} style={{ height }}>
        <canvas ref={staticRef} className="tl__canvas" style={{ width, height }} aria-hidden="true" />
        <canvas
          ref={cursorRef}
          className="tl__canvas tl__cursor"
          style={{ width, height }}
          role="slider"
          tabIndex={0}
          aria-label={t('tl.position')}
          aria-valuemin={Number(clip.t0.toFixed(2))}
          aria-valuemax={Number(clip.t1.toFixed(2))}
          aria-valuenow={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
        />
        {tip && hover && (
          <div
            className="tl__tip"
            style={tip.right ? { right: width - hover.x + 12 } : { left: hover.x + 12 }}
            aria-hidden="true"
          >
            <span className="tl__tip-time num">{tip.time}</span>
            {tip.parts.length > 0 && <span className="tl__tip-text">{tip.parts.join(', ')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
