import type { PlayerVideo } from './player';

/** A clip that is only a clock: stands in for the <video> when a saved analysis is open without its video. */
export interface ClockVideo extends Omit<PlayerVideo, 'paused' | 'ended'> {
  paused: boolean;
  ended: boolean;
  /** Moves the clock forward by `seconds` of clip time while it plays; stops it at the end. */
  advance(seconds: number): void;
}

/** `onPlaying` mirrors the play and pause events of a real video. */
export function createClockVideo(duration: number, onPlaying: (playing: boolean) => void, start = 0): ClockVideo {
  const clock: ClockVideo = {
    currentTime: Math.min(Math.max(start, 0), duration),
    duration,
    paused: true,
    ended: false,
    play() {
      if (!clock.paused) return;
      clock.paused = false;
      clock.ended = false;
      onPlaying(true);
    },
    pause() {
      if (clock.paused) return;
      clock.paused = true;
      onPlaying(false);
    },
    advance(seconds) {
      if (clock.paused) return;
      clock.currentTime += seconds;
      if (clock.currentTime >= clock.duration) {
        clock.currentTime = clock.duration;
        clock.ended = true;
        clock.pause();
      }
    },
  };
  return clock;
}
