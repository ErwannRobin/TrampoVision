/** Pure geometry of the timeline: time to pixels, the flights of a clip, the zoom window, the ruler, hit testing. */

export interface TimeWindow {
  t0: number;
  t1: number;
}

/** The horizontal part of the canvas the time axis is drawn on. */
export interface PlotBox {
  left: number;
  width: number;
}

/** What the timeline needs to know about a jump. Takeoff or landing is null when the clip cuts the flight off. */
export interface CycleTimes {
  index: number;
  takeoffTimeS: number | null;
  apexTimeS: number;
  landingTimeS: number | null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function timeToX(t: number, win: TimeWindow, plot: PlotBox): number {
  return plot.left + ((t - win.t0) / (win.t1 - win.t0 || 1)) * plot.width;
}

/** The time under a pixel, held inside the window. */
export function xToTime(x: number, win: TimeWindow, plot: PlotBox): number {
  const f = clamp((x - plot.left) / (plot.width || 1), 0, 1);
  return win.t0 + f * (win.t1 - win.t0);
}

export interface FlightSpan {
  start: number;
  end: number;
  /** The clip starts or ends in mid-air: that side has no takeoff or landing. */
  openStart: boolean;
  openEnd: boolean;
}

/** From takeoff to landing; a missing one is the edge of the clip. */
export function flightSpan(c: Pick<CycleTimes, 'takeoffTimeS' | 'landingTimeS'>, clip: TimeWindow): FlightSpan {
  return {
    start: c.takeoffTimeS ?? clip.t0,
    end: c.landingTimeS ?? clip.t1,
    openStart: c.takeoffTimeS === null,
    openEnd: c.landingTimeS === null,
  };
}

/** The jump whose flight contains `t`, or -1 (on the bed, between jumps). */
export function jumpAt(t: number, cycles: CycleTimes[], clip: TimeWindow): number {
  for (const c of cycles) {
    const s = flightSpan(c, clip);
    if (t >= s.start && t <= s.end) return c.index;
  }
  return -1;
}

/** Shortest window the zoom shows, seconds: a very short flight still gets room. */
export const MIN_ZOOM_SPAN_S = 1.2;

/** A window around one flight with a margin (a share of its length) on each side, never longer than the clip. */
export function jumpWindow(span: FlightSpan, clip: TimeWindow, margin = 0.25): TimeWindow {
  const length = Math.max(span.end - span.start, 0.05);
  const total = clip.t1 - clip.t0;
  const wanted = Math.min(Math.max(length * (1 + 2 * margin), MIN_ZOOM_SPAN_S), total);
  const center = (span.start + span.end) / 2;
  const t0 = clamp(center - wanted / 2, clip.t0, Math.max(clip.t0, clip.t1 - wanted));
  return { t0, t1: t0 + wanted };
}

export const mixWindows = (a: TimeWindow, b: TimeWindow, k: number): TimeWindow => ({
  t0: a.t0 + (b.t0 - a.t0) * k,
  t1: a.t1 + (b.t1 - a.t1) * k,
});

export const windowsClose = (a: TimeWindow, b: TimeWindow, eps: number) =>
  Math.abs(a.t0 - b.t0) < eps && Math.abs(a.t1 - b.t1) < eps;

const RULER_STEPS_S = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Times for the ruler: the smallest round step that keeps the labels `minGapPx` apart. */
export function rulerTicks(win: TimeWindow, plotWidth: number, minGapPx = 64): { step: number; times: number[] } {
  const span = win.t1 - win.t0;
  if (!(span > 0) || !(plotWidth > 0)) return { step: 1, times: [] };
  const pxPerS = plotWidth / span;
  const step = RULER_STEPS_S.find((s) => s * pxPerS >= minGapPx) ?? RULER_STEPS_S[RULER_STEPS_S.length - 1];
  const times: number[] = [];
  for (let t = Math.ceil(win.t0 / step - 1e-9) * step; t <= win.t1 + 1e-9; t += step) times.push(Number(t.toFixed(6)));
  return { step, times };
}

export type EventKind = 'takeoff' | 'apex' | 'landing';

export interface TimelineEvent {
  kind: EventKind;
  jump: number;
  time: number;
}

/** Takeoff, apex and landing of every jump; an event the clip cut off does not exist. */
export function timelineEvents(cycles: CycleTimes[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const c of cycles) {
    if (c.takeoffTimeS !== null) out.push({ kind: 'takeoff', jump: c.index, time: c.takeoffTimeS });
    out.push({ kind: 'apex', jump: c.index, time: c.apexTimeS });
    if (c.landingTimeS !== null) out.push({ kind: 'landing', jump: c.index, time: c.landingTimeS });
  }
  return out;
}

/** The event within `tolPx` of a pixel, the closest one. */
export function nearestEvent(
  x: number,
  events: TimelineEvent[],
  win: TimeWindow,
  plot: PlotBox,
  tolPx = 8,
): TimelineEvent | null {
  let best: TimelineEvent | null = null;
  let bestD = tolPx;
  for (const e of events) {
    const d = Math.abs(timeToX(e.time, win, plot) - x);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Stretches of the clip (seconds) where the pose was unclear. Each sample stands for the time up to the next one. */
export function lowConfidenceSpans(
  time: ArrayLike<number>,
  confidence: ArrayLike<number>,
  threshold = 0.5,
): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const n = Math.min(time.length, confidence.length);
  let from: number | null = null;
  for (let i = 0; i < n; i++) {
    const unclear = !(confidence[i] >= threshold);
    if (unclear && from === null) from = time[i];
    if (!unclear && from !== null) {
      spans.push({ from, to: time[i] });
      from = null;
    }
  }
  if (from !== null && n > 0) {
    const step = n > 1 ? time[n - 1] - time[n - 2] : 0;
    spans.push({ from, to: time[n - 1] + step });
  }
  return spans;
}
