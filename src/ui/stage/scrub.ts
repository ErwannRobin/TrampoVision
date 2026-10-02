import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import type { Playhead } from '../playhead';

/** A finger has to move this far sideways before a touch is a swipe and not a tap. */
export const SWIPE_THRESHOLD_PX = 10;
/** Dragging across this much of the screen (at most) moves the video by `SCRUB_SPAN_S`. Wider screens do not make the swipe touchier. */
export const SCRUB_REFERENCE_PX = 520;
/** What a drag across the reference width covers: a whole jump and a little more, so one swipe can find any frame of it. */
export const SCRUB_SPAN_S = 4;
/** A finger dragged down this far (and more down than sideways) leaves the full screen. */
export const EXIT_DRAG_PX = 48;
/** A touch shorter than this, that did not move, is a tap. */
const TAP_MAX_MS = 500;
/** A finger that stays down this long, without moving, is a long press: the video pauses until it lifts. */
export const LONG_PRESS_MS = 350;

/**
 * Where the video goes when the finger has moved `dx` pixels (right = forward) since the swipe began at `startS`.
 * The same distance always means the same time, whatever the clip: a full swipe is a few seconds, so at 30 frames a second
 * a frame is about 7 px.
 */
export function scrubTime(startS: number, dx: number, widthPx: number, durationS: number): number {
  if (!(durationS > 0)) return Math.max(0, startS);
  const span = Math.min(Math.max(widthPx, 1), SCRUB_REFERENCE_PX);
  const t = startS + (dx / span) * SCRUB_SPAN_S;
  return Math.min(Math.max(t, 0), durationS);
}

/** Touches that start on a control belong to the control. */
const isControl = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest('[data-stage-control]');

interface Touch {
  id: number;
  x: number;
  y: number;
  startedAt: number;
  /** Set once the touch became a swipe. */
  swipe: { fromX: number; startS: number; resume: boolean } | null;
  /** Set once the touch became a long press: whether the video was playing and must go on when the finger lifts. */
  hold: { resume: boolean } | null;
  /** Set once the touch went down more than sideways: it is for leaving the full screen, not for moving the video. */
  down: boolean;
}

export interface ScrubOptions {
  enabled: boolean;
  playhead: Playhead;
  /** A tap (short, not moved), not on a control. */
  onTap: () => void;
  /** A swipe began (true) or ended (false). */
  onSwipe: (swiping: boolean) => void;
  /** A finger was dragged down the picture (the full screen's way out). Without it a vertical drag is left to the page, which scrolls. */
  onExit?: () => void;
}

/**
 * Moving the finger right or left on the stage moves the video, a frame at a time: the video pauses while the finger is
 * down and goes on from where it was left if it was playing. A tap is passed on (`onTap`). A finger held still pauses the
 * video until it lifts (a mouse button held down does not: that is a slow click). A small drag down leaves the full screen
 * (`onExit`); a drag up is left alone.
 */
export function useScrub({ enabled, playhead, onTap, onSwipe, onExit }: ScrubOptions) {
  const touch = useRef<Touch | null>(null);
  const timer = useRef(0);

  const stopTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  }, []);
  // Leaving the full screen with a finger down: nothing may fire afterwards.
  useEffect(() => {
    if (!enabled) {
      stopTimer();
      touch.current = null;
    }
    return stopTimer;
  }, [enabled, stopTimer]);

  const down = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!enabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || isControl(e.target)) return;
      const t: Touch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startedAt: e.timeStamp,
        swipe: null,
        hold: null,
        down: false,
      };
      touch.current = t;
      stopTimer();
      if (e.pointerType === 'mouse') return;
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        if (touch.current !== t || t.swipe) return;
        t.hold = { resume: playhead.getPlaying() && !playhead.getReverse() };
        playhead.pause();
      }, LONG_PRESS_MS);
    },
    [enabled, playhead, stopTimer],
  );

  const move = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const t = touch.current;
      if (!t || t.id !== e.pointerId) return;
      if (!t.swipe) {
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        if (!t.down && Math.abs(dy) > SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
          stopTimer();
          if (dy < 0 || !onExit) {
            // Up (or down, with nowhere to go): not ours. A long press that began stays paused no longer than the finger.
            if (t.hold?.resume) playhead.toggle();
            touch.current = null;
            return;
          }
          t.down = true;
        }
        if (t.down) {
          if (dy >= EXIT_DRAG_PX) {
            touch.current = null;
            if (t.hold?.resume) playhead.toggle();
            onExit?.();
          }
          return;
        }
        if (Math.abs(dx) <= SWIPE_THRESHOLD_PX) return;
        stopTimer();
        // The swipe starts where the finger is now, so the picture does not jump by the threshold.
        const resume = t.hold ? t.hold.resume : playhead.getPlaying() && !playhead.getReverse();
        t.swipe = { fromX: e.clientX, startS: playhead.getSnapshot(), resume };
        e.currentTarget.setPointerCapture(e.pointerId);
        playhead.pause();
        onSwipe(true);
      }
      const width = e.currentTarget.getBoundingClientRect().width;
      playhead.seek(scrubTime(t.swipe.startS, e.clientX - t.swipe.fromX, width, playhead.getDuration()));
    },
    [playhead, onSwipe, onExit, stopTimer],
  );

  const end = useCallback(
    (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const t = touch.current;
      if (!t || t.id !== e.pointerId) return;
      touch.current = null;
      stopTimer();
      if (t.swipe) {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (t.swipe.resume) playhead.toggle();
        onSwipe(false);
      } else if (t.hold) {
        if (t.hold.resume) playhead.toggle();
      } else if (t.down) {
        // A short drag down that did not get far enough: nothing.
      } else if (!cancelled && e.timeStamp - t.startedAt <= TAP_MAX_MS) {
        onTap();
      }
    },
    [playhead, onSwipe, onTap, stopTimer],
  );

  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
    // A long press must not open the browser's menu on the picture.
    onContextMenu: (e: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>) => {
      if (enabled && !isControl(e.target)) e.preventDefault();
    },
  };
}
