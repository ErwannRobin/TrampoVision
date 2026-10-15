/**
 * The touch controls of a video on the debug page: a tap plays or pauses, a finger moved sideways moves the position (the whole clip
 * across the width of the video), and a finger moved up or down scrolls the page as usual. The decisions are plain functions, tested
 * without a browser; `attachGestures` wires them to pointer events.
 */

/** A finger that moved less than this, CSS pixels, has not moved: it is a tap if it lifts soon enough. */
export const SLOP_PX = 10;
/** A press longer than this is not a tap. */
export const TAP_MS = 500;

export type Gesture = 'undecided' | 'tap' | 'scrub' | 'scroll';

/** What a press is so far, from how far the finger moved since it went down and for how long; `lifted` once it is up. */
export function classify(dx: number, dy: number, elapsedMs: number, lifted: boolean): Gesture {
  const moved = Math.hypot(dx, dy) >= SLOP_PX;
  if (moved) return Math.abs(dx) > Math.abs(dy) ? 'scrub' : 'scroll';
  if (lifted) return elapsedMs <= TAP_MS ? 'tap' : 'undecided';
  return 'undecided';
}

/** The frame a scrub lands on: from `start`, moved `dx` pixels on a video `width` pixels wide that stands for `total` frames. */
export function scrubIndex(start: number, dx: number, width: number, total: number): number {
  const index = Math.round(start + (dx / Math.max(1, width)) * total);
  return Math.min(Math.max(0, total - 1), Math.max(0, index));
}

export interface GestureHandlers {
  /** Whether sideways moves scrub (touch screens) or are left alone (a mouse). */
  scrubs(): boolean;
  /** The frame shown, and how many there are; null while there is no video. */
  position(): { index: number; total: number } | null;
  tap(): void;
  scrubStart(): void;
  scrub(index: number): void;
  scrubEnd(): void;
}

/** Wires the gestures to `element` (a video panel). Its CSS lets the browser scroll up and down (`touch-action: pan-y`) and leaves the rest to this. */
export function attachGestures(element: HTMLElement, handlers: GestureHandlers): void {
  let press: {
    id: number;
    x: number;
    y: number;
    at: number;
    start: number;
    kind: Gesture;
    /** It went down on a button of the video (play and pause): a tap there is the button's click, a slide is still a slide. */
    onButton: boolean;
  } | null = null;

  element.addEventListener('pointerdown', (event) => {
    // A new press ends one whose end was not seen (a mouse let go outside the video).
    if (!event.isPrimary || event.button !== 0) return;
    const position = handlers.position();
    if (!position) return;
    const onButton = event.target instanceof Element && event.target.closest('button') !== null;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      start: position.index,
      kind: 'undecided',
      onButton,
    };
  });

  element.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (press.kind === 'undecided') {
      const kind = classify(dx, dy, event.timeStamp - press.at, false);
      if (kind === 'scrub' && !handlers.scrubs()) {
        press = null;
        return;
      }
      if (kind === 'scroll') {
        // The page scrolls; the browser takes the finger over (`pointercancel`).
        press = null;
        return;
      }
      if (kind !== 'scrub') return;
      press.kind = 'scrub';
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-scrubbing');
      handlers.scrubStart();
    }
    const position = handlers.position();
    if (position) handlers.scrub(scrubIndex(press.start, dx, element.clientWidth, position.total));
  });

  const end = (event: PointerEvent, cancelled: boolean) => {
    if (!press || event.pointerId !== press.id) return;
    const { kind } = press;
    const tap =
      !cancelled &&
      kind === 'undecided' &&
      !press.onButton &&
      classify(event.clientX - press.x, event.clientY - press.y, event.timeStamp - press.at, true) === 'tap';
    press = null;
    if (kind === 'scrub') {
      element.classList.remove('is-scrubbing');
      handlers.scrubEnd();
    } else if (tap) {
      handlers.tap();
    }
  };
  element.addEventListener('pointerup', (event) => end(event, false));
  element.addEventListener('pointercancel', (event) => end(event, true));
}
