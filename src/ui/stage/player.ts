import { frameAtTime, frameSeekTime } from '../../video/frames';

/** The part of an HTMLVideoElement the player drives: small enough to stand in for it in a test. */
export interface PlayerVideo {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
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

/** A range ends this long before the clip does, so the video never has to stop by itself (which would end a loop). */
const RANGE_END_MARGIN_S = 0.05;
/** Pressing play this close to the end starts the clip over. */
const RESTART_WITHIN_S = 0.05;

/**
 * Transport for one video at a known frame rate. Every seek lands in the middle of a frame's interval, so the decoder
 * shows the frame that was asked for and not the one before it.
 */
export function createPlayer(video: PlayerVideo, fps: number) {
  let range: Range | null = null;

  const play = () => {
    // A play() that is interrupted by a pause() rejects; the events already say what state the video is in.
    void Promise.resolve(video.play()).catch(() => undefined);
  };

  const seekFrame = (frame: number) => {
    const frames = frameCount(video.duration, fps);
    if (!frames) return;
    const clamped = Math.min(Math.max(frame, 0), frames - 1);
    video.currentTime = Math.min(frameSeekTime(clamped, fps), Math.max(0, video.duration - 1e-3));
  };

  return {
    seek: (time: number) => seekFrame(frameAtTime(time, fps)),

    /** Pause and move by whole frames (negative = back). */
    step: (frames: number) => {
      range = null;
      video.pause();
      seekFrame(frameAtTime(video.currentTime, fps) + frames);
    },

    toggle: () => {
      if (video.paused) {
        if (video.ended || video.currentTime >= video.duration - RESTART_WITHIN_S) video.currentTime = 0;
        play();
      } else {
        range = null;
        video.pause();
      }
    },

    pause: () => {
      range = null;
      video.pause();
    },

    playRange: (from: number, to: number, loop: boolean) => {
      seekFrame(frameAtTime(from, fps));
      range = { from, to, loop };
      play();
    },

    /** For a pause that came from somewhere else (the browser, the end of the clip). */
    clearRange: () => {
      range = null;
    },

    /** Once per animation frame: stops the range at its end, or takes a looping one back to its start. */
    tick: () => {
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
