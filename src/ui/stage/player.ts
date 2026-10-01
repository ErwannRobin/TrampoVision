import { frameAtTime, frameSeekTime } from '../../video/frames';

/** The part of an HTMLVideoElement the player drives: small enough to stand in for it in a test. */
export interface PlayerVideo {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  /** True while the decoder is still getting to a frame that was asked for (a real video; a clock never is). */
  readonly seeking?: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

/** Whole frames in the clip; 0 while the duration is not known. */
export function frameCount(duration: number, fps: number): number {
  return Number.isFinite(duration) && duration > 0 && fps > 0 ? Math.max(1, Math.floor(duration * fps)) : 0;
}

/** A stretch of the clip that plays on request ("play this jump"), in seconds. */
interface Range {
  from: number;
  to: number;
  loop: boolean;
}

export interface PlayerOptions {
  /** The playback speed, asked for when it is needed: a video cannot play backwards, so reverse play moves the clock itself. */
  rate?: () => number;
  /** Reverse play started or stopped, whatever stopped it (the end of the clip included). */
  onReverse?: (active: boolean) => void;
}

/** Reverse play: one animation frame never moves the clip by more than this, so a stalled tab does not jump back seconds. */
const REVERSE_MAX_STEP_S = 0.25;

/** A range ends this long before the clip does, so the video never has to stop by itself (which would end a loop). */
const RANGE_END_MARGIN_S = 0.05;
/** Pressing play this close to the end starts the clip over. */
const RESTART_WITHIN_S = 0.05;

/**
 * Transport for one video at a known frame rate. Every seek lands in the middle of a frame's interval, so the decoder
 * shows the frame that was asked for and not the one before it.
 */
export function createPlayer(video: PlayerVideo, fps: number, options: PlayerOptions = {}) {
  let range: Range | null = null;
  // Reverse play: a video element cannot play backwards, so the player walks it back one frame at a time. `pos` is where the clip
  // should be now (it keeps running while the decoder is busy, so frames are dropped and the speed stays true), `shown` the frame asked for.
  let reversing: { pos: number; last: number | null; shown: number } | null = null;

  const setReversing = (next: typeof reversing) => {
    const was = reversing !== null;
    reversing = next;
    if (was !== (next !== null)) options.onReverse?.(next !== null);
  };

  const play = () => {
    setReversing(null);
    // A play() that is interrupted by a pause() rejects; the events already say what state the video is in.
    void Promise.resolve(video.play()).catch(() => undefined);
  };

  const seekFrame = (frame: number) => {
    const frames = frameCount(video.duration, fps);
    if (!frames) return;
    const clamped = Math.min(Math.max(frame, 0), frames - 1);
    video.currentTime = Math.min(frameSeekTime(clamped, fps), Math.max(0, video.duration - 1e-3));
  };

  /** Once per animation frame while playing backwards. */
  const stepReverse = (r: NonNullable<typeof reversing>, now: number) => {
    const dt = r.last === null ? 0 : Math.min((now - r.last) / 1000, REVERSE_MAX_STEP_S);
    r.last = now;
    r.pos -= dt * (options.rate?.() ?? 1);
    const frame = frameAtTime(r.pos, fps);
    if (frame <= 0) {
      seekFrame(0);
      setReversing(null);
    } else if (frame !== r.shown && !video.seeking) {
      r.shown = frame;
      seekFrame(frame);
    }
  };

  return {
    seek: (time: number) => {
      setReversing(null);
      seekFrame(frameAtTime(time, fps));
    },

    /** Pause and move by whole frames (negative = back). */
    step: (frames: number) => {
      setReversing(null);
      range = null;
      video.pause();
      seekFrame(frameAtTime(video.currentTime, fps) + frames);
    },

    /** Play backwards, at the playback speed; again to stop. From the first frame it starts over from the end. */
    reverse: () => {
      if (reversing) {
        setReversing(null);
        return;
      }
      const frames = frameCount(video.duration, fps);
      if (!frames) return;
      range = null;
      video.pause();
      if (frameAtTime(video.currentTime, fps) <= 0) seekFrame(frames - 1);
      setReversing({ pos: video.currentTime, last: null, shown: frameAtTime(video.currentTime, fps) });
    },

    isReversing: () => reversing !== null,

    toggle: () => {
      if (reversing) {
        setReversing(null);
        return;
      }
      if (video.paused) {
        if (video.ended || video.currentTime >= video.duration - RESTART_WITHIN_S) video.currentTime = 0;
        play();
      } else {
        range = null;
        video.pause();
      }
    },

    pause: () => {
      setReversing(null);
      range = null;
      video.pause();
    },

    playRange: (from: number, to: number, loop: boolean) => {
      setReversing(null);
      seekFrame(frameAtTime(from, fps));
      range = { from, to, loop };
      play();
    },

    /** For a pause that came from somewhere else (the browser, the end of the clip). */
    clearRange: () => {
      range = null;
    },

    /** Once per animation frame: walks reverse play back, stops the range at its end, or takes a looping one back to its start. */
    tick: (now: number = performance.now()) => {
      if (reversing) {
        stepReverse(reversing, now);
        return;
      }
      if (!range || video.paused || !Number.isFinite(video.duration)) return;
      const end = Math.min(range.to, video.duration - RANGE_END_MARGIN_S);
      if (video.currentTime < end) return;
      const restart = frameSeekTime(frameAtTime(range.from, fps), fps);
      if (range.loop && restart < end) seekFrame(frameAtTime(range.from, fps));
      else {
        range = null;
        video.pause();
      }
    },
  };
}
