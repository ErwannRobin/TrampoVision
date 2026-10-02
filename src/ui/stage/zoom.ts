import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Point } from '../../pose/types';
import { isControl } from './scrub';
import type { Size } from './fit';

/** The most the picture can be enlarged: enough to see a hand or a foot, no more than the video's pixels can give. */
export const MAX_ZOOM = 5;
/** A pinch that ends below this is a pinch back to the whole picture: it snaps to it. */
const SNAP_ZOOM = 1.05;

/**
 * How the picture sits in its frame: enlarged `zoom` times around the center of the frame, then moved by (`x`, `y`) pixels. It is
 * the CSS transform `translate(x, y) scale(zoom)` of the layer that holds the video and what is drawn on it.
 */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const NO_ZOOM: View = { zoom: 1, x: 0, y: 0 };

export const isZoomed = (v: View) => v.zoom > 1.001;

/** The most the picture can be moved: its edge stops at the edge of the frame, so the frame is always full. */
function clampView(v: View, size: Size): View {
  const zoom = Math.min(Math.max(Number.isFinite(v.zoom) ? v.zoom : 1, 1), MAX_ZOOM);
  if (zoom === 1) return NO_ZOOM;
  const mx = ((zoom - 1) * Math.max(size.width, 0)) / 2;
  const my = ((zoom - 1) * Math.max(size.height, 0)) / 2;
  return { zoom, x: Math.min(Math.max(v.x, -mx), mx), y: Math.min(Math.max(v.y, -my), my) };
}

/**
 * The view when the point of the picture that was under `from` (relative to the center of the frame) is now under `to`, with the
 * picture enlarged `scale` times more than at `start`: two fingers that spread and move take hold of the picture where they landed.
 */
export function pinchView(start: View, from: Point, to: Point, scale: number, size: Size): View {
  const zoom = Math.min(Math.max(start.zoom * (Number.isFinite(scale) && scale > 0 ? scale : 1), 1), MAX_ZOOM);
  const ux = (from.x - start.x) / start.zoom;
  const uy = (from.y - start.y) / start.zoom;
  return clampView({ zoom, x: to.x - zoom * ux, y: to.y - zoom * uy }, size);
}

/** The view after enlarging `factor` times around `at` (relative to the center of the frame): the point under it stays there. */
export function zoomAt(view: View, factor: number, at: Point, size: Size): View {
  return pinchView(view, at, at, factor, size);
}

const settle = (v: View) => (v.zoom < SNAP_ZOOM ? NO_ZOOM : v);

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The resolution the overlay is drawn at: the picture enlarged shows a sharp skeleton, within what a phone's memory allows. */
export function overlayScale(dpr: number, zoom: number): number {
  return Math.min(Math.max(dpr, 1) * Math.max(zoom, 1), 4);
}

export interface ZoomOptions {
  enabled: boolean;
  /** The element the picture is shown in: the pinch is measured from its center. */
  frameRef: RefObject<HTMLElement | null>;
  /** Changes when the frame is another element (a new clip, the full screen): the picture is shown whole again. */
  resetKey: string;
}

/**
 * Two fingers on the picture enlarge it and move it (a single finger keeps moving the video: see scrub.ts), and so does the trackpad
 * pinch of a laptop (a wheel with the Control key). The view is `{ zoom: 1 }` until then.
 */
export function useZoom({ enabled, frameRef, resetKey }: ZoomOptions) {
  const [view, setView] = useState<View>(NO_ZOOM);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ from: Point; apart: number; start: View } | null>(null);

  const reset = useCallback(() => {
    pinch.current = null;
    pointers.current.clear();
    setView(NO_ZOOM);
  }, []);
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);
  useEffect(() => reset(), [resetKey, reset]);

  const measure = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect();
    return rect ? { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, size: rect } : null;
  }, [frameRef]);

  const down = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const m = measure();
      if (!enabled || !m || e.pointerType === 'mouse' || isControl(e.target)) return;
      pointers.current.set(e.pointerId, { x: e.clientX - m.cx, y: e.clientY - m.cy });
      if (pointers.current.size !== 2) return;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      pinch.current = { from: middle(a, b), apart: Math.max(distance(a, b), 1), start: viewRef.current };
    },
    [enabled, measure],
  );
  const move = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const m = measure();
      if (!m || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX - m.cx, y: e.clientY - m.cy });
      const p = pinch.current;
      if (!p || pointers.current.size !== 2) return;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      setView(pinchView(p.start, p.from, middle(a, b), distance(a, b) / p.apart, m.size));
    },
    [measure],
  );
  const up = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (!pinch.current) return;
    pinch.current = null;
    setView(settle);
  }, []);

  // A laptop's pinch arrives as a wheel with the Control key, and the browser would zoom the page with it: it has to be stopped
  // before it happens, which a listener of React's cannot do.
  useEffect(() => {
    const el = frameRef.current;
    if (!enabled || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const m = measure();
      if (!m) return;
      const at = { x: e.clientX - m.cx, y: e.clientY - m.cy };
      setView((v) => {
        const next = zoomAt(v, Math.exp(-e.deltaY * 0.01), at, m.size);
        return next.zoom < 1.02 ? NO_ZOOM : next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enabled, frameRef, measure, resetKey]);

  return {
    view,
    reset,
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
  };
}
