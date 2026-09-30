import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { t } from '../i18n';
import { readColors, drawChart, drawCursor, fitCanvas, type ChartColors } from './charts/draw';
import { chartDomain, indexAt, makePlot } from './charts/geometry';
import type { ChartProps } from './charts/types';
import { fmt } from './format';
import { useElementSize } from './hooks';
import { usePlayheadTime, type Playhead } from './playhead';
import { useThemeVersion } from './theme';

export type { ChartAxis, ChartBand, ChartGuide, ChartMarker, ChartProps, ChartSeries } from './charts/types';
export { niceTicks } from './charts/geometry';

/** Room for the value labels on the left, the event glyphs above the plot and the time labels under it. */
const MARGIN = { left: 46, right: 10, top: 18, bottom: 26 };

/** True while the element is on screen: a chart that cannot be seen does not follow the playhead. */
function useInView(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting)), {
      rootMargin: '120px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return seen;
}

/** The values at the playhead (or under the pointer), beside the legend. The only part that re-renders with playback. */
function Legend({
  series,
  time,
  playhead,
  axis,
  decimals,
  hover,
}: Pick<ChartProps, 'series' | 'time' | 'playhead' | 'axis'> & { decimals: number; hover: number | null }) {
  const t = usePlayheadTime(playhead as Playhead);
  const x = hover ?? (axis ? axis.toX(t) : t);
  const i = indexAt(time, x);
  return (
    <span className="chart__legend">
      {series.map((s) => (
        <span key={s.label} className="chart__legend-item">
          <i className="chart__swatch" style={{ background: `var(${s.color})` }} />
          {series.length > 1 && <span className="chart__label">{s.label}</span>}
          <span className="chart__value num">{fmt(s.values[i], decimals)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A curve over time, as a figure on the page: a static layer (flights, grid, guides, curves, events) that redraws when
 * its inputs change, and a cursor layer that follows the playhead without re-rendering the chart.
 */
export function Chart({
  title,
  unit,
  time,
  series,
  playhead,
  confidence,
  decimals = 1,
  zeroLine = false,
  height = 156,
  yDomain,
  minSpan = 1e-6,
  breakOnJump,
  markers,
  bands,
  guides,
  axis,
  note,
}: ChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrapRef);
  const theme = useThemeVersion();
  const inView = useInView(wrapRef);
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const dragging = useRef(false);

  const domain = useMemo(
    () => yDomain ?? chartDomain(series, { zeroLine, minSpan, guides }),
    [yDomain, series, zeroLine, minSpan, guides],
  );
  const extent: [number, number] = [time[0] ?? 0, time[time.length - 1] ?? 1];
  const plot = useMemo(
    () => makePlot(width, height, MARGIN, [extent[0], extent[1]], domain),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, extent[0], extent[1], domain],
  );
  const seriesKey = series.map((s) => s.color).join('|');
  const colors = useMemo<ChartColors>(
    () => readColors(seriesKey.split('|')),
    // A new theme means new colors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesKey, theme],
  );

  const latest = useRef({ plot, colors, time, series, axis, width, height });
  latest.current = { plot, colors, time, series, axis, width, height };

  const paintCursor = useCallback(() => {
    const canvas = cursorRef.current;
    const l = latest.current;
    if (!canvas || l.width === 0) return;
    const ctx = fitCanvas(canvas, l.width, l.height);
    if (!ctx) return;
    const t = playhead.getSnapshot();
    const at = l.axis ? l.axis.toX(t) : t;
    drawCursor(ctx, l.plot, { time: l.time, series: l.series, axis: l.axis }, l.colors, at, hoverRef.current);
  }, [playhead]);

  useEffect(() => {
    const canvas = plotRef.current;
    if (!canvas || width === 0) return;
    const ctx = fitCanvas(canvas, width, height);
    if (ctx)
      drawChart(ctx, plot, { time, series, confidence, breakOnJump, markers, bands, guides, axis, zeroLine }, colors);
    paintCursor();
  }, [
    plot,
    colors,
    time,
    series,
    confidence,
    breakOnJump,
    markers,
    bands,
    guides,
    axis,
    zeroLine,
    width,
    height,
    paintCursor,
  ]);

  // Follow the playhead only while on screen.
  useEffect(() => {
    if (!inView) return;
    paintCursor();
    return playhead.subscribe(paintCursor);
  }, [inView, playhead, paintCursor]);

  const seekTo = (e: PointerEvent<HTMLCanvasElement>) => {
    const x = plot.xAt(e.clientX - e.currentTarget.getBoundingClientRect().left);
    playhead.seek(axis ? axis.toSeconds(x) : x);
    return x;
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const x = plot.xAt(e.clientX - e.currentTarget.getBoundingClientRect().left);
    if (e.pointerType !== 'touch') {
      hoverRef.current = x;
      setHover(x);
      paintCursor();
    }
    if (dragging.current) playhead.seek(axis ? axis.toSeconds(x) : x);
  };
  const onLeave = () => {
    dragging.current = false;
    hoverRef.current = null;
    setHover(null);
    paintCursor();
  };

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="chart__title">
          {title}
          <span className="chart__unit">{unit}</span>
        </span>
        <Legend series={series} time={time} playhead={playhead} axis={axis} decimals={decimals} hover={hover} />
      </figcaption>
      <div ref={wrapRef} className="chart__body" style={{ height }}>
        <canvas ref={plotRef} className="chart__canvas" style={{ width, height }} aria-hidden="true" />
        <canvas
          ref={cursorRef}
          className="chart__canvas chart__cursor"
          style={{ width, height }}
          aria-label={t('chart.aria', { title })}
          role="img"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
            seekTo(e);
          }}
          onPointerMove={onMove}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={onLeave}
          onPointerLeave={onLeave}
        />
      </div>
      {note && <p className="chart__note">{note}</p>}
    </figure>
  );
}
