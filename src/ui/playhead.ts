import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

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
  private reversing = false;
  /** The button that started the range that is playing (see `useRangeButton`), null for a range nobody claimed or no range. */
  private rangeKey: string | null = null;
  /** The key of the button whose click is being handled: the next `playRange` belongs to it. */
  private claimed: string | null = null;
  private timeListeners = new Set<() => void>();
  private stateListeners = new Set<() => void>();

  /** Installed by the stage: performs an actual seek on the <video>. */
  seekHandler: ((time: number) => void) | null = null;
  /** Installed by the stage: plays from `from` to `to` seconds, then stops (or loops). */
  playRangeHandler: ((from: number, to: number, loop: boolean, bounce?: boolean) => void) | null = null;
  /** Installed by the stage: play or pause. */
  toggleHandler: (() => void) | null = null;
  /** Installed by the stage: pause. */
  pauseHandler: (() => void) | null = null;
  /** Installed by the stage: play backwards, or stop doing it. */
  reverseHandler: (() => void) | null = null;
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
  /** The video is playing backwards (`getPlaying` is true then too). */
  getReverse = () => this.reversing;
  /** Which button started the range that is playing now, if one did. */
  getRangeKey = () => this.rangeKey;

  setTime(t: number) {
    if (t === this.t) return;
    this.t = t;
    this.timeListeners.forEach((l) => l());
  }
  setPlaying(playing: boolean) {
    if (!playing) this.rangeKey = null;
    if (playing === this.playing) return;
    this.playing = playing;
    this.stateListeners.forEach((l) => l());
  }
  /** The range that plays next is for the button `key` (null: for nobody). Set around the click handler, then taken back. */
  claim(key: string | null) {
    this.claimed = key;
  }
  /** Whatever plays now is not a range a button started any more (the video was paused, stepped or played backwards by hand). */
  private release() {
    if (this.rangeKey === null) return;
    this.rangeKey = null;
    this.stateListeners.forEach((l) => l());
  }
  setReverse(reversing: boolean) {
    if (reversing === this.reversing) return;
    this.reversing = reversing;
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
  playRange(from: number, to: number, loop = false, bounce = false) {
    this.rangeKey = this.claimed;
    this.claimed = null;
    this.playRangeHandler?.(from, to, loop, bounce);
    this.stateListeners.forEach((l) => l());
  }
  toggle() {
    this.release();
    this.toggleHandler?.();
  }
  pause() {
    this.release();
    this.pauseHandler?.();
  }
  step(frames: number) {
    this.release();
    this.stepHandler?.(frames);
  }
  /** Play backwards; again to stop. */
  reverse() {
    this.release();
    this.reverseHandler?.();
  }
}

export const usePlayheadTime = (p: Playhead) => useSyncExternalStore(p.subscribe, p.getSnapshot);
export const usePlaying = (p: Playhead) => useSyncExternalStore(p.subscribeState, p.getPlaying);
export const useReverse = (p: Playhead) => useSyncExternalStore(p.subscribeState, p.getReverse);
export const useDuration = (p: Playhead) => useSyncExternalStore(p.subscribeState, p.getDuration);

/** The player bus for the buttons that start a range ("play this jump") far from the stage: they find it here. */
export const PlayheadContext = createContext<Playhead | null>(null);

const noSubscribe = () => () => undefined;
const never = () => false;

/**
 * A button that plays a stretch of the clip. While the stretch it started plays it shows pause and a press pauses; any other
 * button of the page is still a play button and plays its own stretch at once. `key` names the button (one per place in the page).
 */
export function useRangeButton(key: string, onPlay: () => void): { playing: boolean; press: () => void } {
  const playhead = useContext(PlayheadContext);
  const playing = useSyncExternalStore(
    playhead ? playhead.subscribeState : noSubscribe,
    playhead ? () => playhead.getPlaying() && playhead.getRangeKey() === key : never,
    never,
  );
  const press = useCallback(() => {
    if (playhead && playhead.getPlaying() && playhead.getRangeKey() === key) {
      playhead.pause();
      return;
    }
    playhead?.claim(key);
    try {
      onPlay();
    } finally {
      playhead?.claim(null);
    }
  }, [playhead, key, onPlay]);
  return { playing, press };
}
