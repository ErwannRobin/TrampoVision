import { useSyncExternalStore } from 'react';

/**
 * The player bus. A tiny external store for the current video time and play state, so the timeline, the charts, the
 * panels and the overlay follow playback at frame rate without re-rendering the whole React tree, and the transport bar
 * and the timeline can drive a video they do not own: the stage installs the handlers below and everything else calls
 * the methods.
 */
export class Playhead {
  private t = 0;
  private playing = false;
  private duration = 0;
  private timeListeners = new Set<() => void>();
  private stateListeners = new Set<() => void>();

  /** Installed by the stage: performs an actual seek on the <video>. */
  seekHandler: ((time: number) => void) | null = null;
  /** Installed by the stage: plays from `from` to `to` seconds, then stops (or loops). */
  playRangeHandler: ((from: number, to: number, loop: boolean) => void) | null = null;
  /** Installed by the stage: play or pause. */
  toggleHandler: (() => void) | null = null;
  /** Installed by the stage: pause. */
  pauseHandler: (() => void) | null = null;
  /** Installed by the stage: pause and move by whole frames (negative = back). */
  stepHandler: ((frames: number) => void) | null = null;

  /** Time in seconds. */
  subscribe = (listener: () => void) => {
    this.timeListeners.add(listener);
    return () => {
      this.timeListeners.delete(listener);
    };
  };
  getSnapshot = () => this.t;

  /** Play state and clip duration: they change rarely. */
  subscribeState = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };
  getPlaying = () => this.playing;
  getDuration = () => this.duration;

  setTime(t: number) {
    if (t === this.t) return;
    this.t = t;
    this.timeListeners.forEach((l) => l());
  }
  setPlaying(playing: boolean) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.stateListeners.forEach((l) => l());
  }
  setDuration(seconds: number) {
    if (seconds === this.duration) return;
    this.duration = seconds;
    this.stateListeners.forEach((l) => l());
  }

  seek(t: number) {
    if (this.seekHandler) this.seekHandler(t);
    else this.setTime(t); // no video loaded (e.g. data opened from a file): just move the cursor
  }
  playRange(from: number, to: number, loop = false) {
    this.playRangeHandler?.(from, to, loop);
  }
  toggle() {
    this.toggleHandler?.();
  }
  pause() {
    this.pauseHandler?.();
  }
  step(frames: number) {
    this.stepHandler?.(frames);
  }
}

export const usePlayheadTime = (p: Playhead) => useSyncExternalStore(p.subscribe, p.getSnapshot);
export const usePlaying = (p: Playhead) => useSyncExternalStore(p.subscribeState, p.getPlaying);
export const useDuration = (p: Playhead) => useSyncExternalStore(p.subscribeState, p.getDuration);
