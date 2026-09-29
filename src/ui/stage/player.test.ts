import { describe, expect, it, vi } from 'vitest';
import { createPlayer, frameCount } from './player';

/** A video that only remembers what it was told: 10 s long, paused at the start. */
function fakeVideo(over: { duration?: number; currentTime?: number; paused?: boolean; ended?: boolean } = {}) {
  const video = {
    currentTime: 0,
    duration: 10,
    paused: true,
    ended: false,
    ...over,
    play: vi.fn(() => {
      video.paused = false;
    }),
    pause: vi.fn(() => {
      video.paused = true;
    }),
  };
  return video;
}

const FPS = 30;
const middleOf = (frame: number) => (frame + 0.5) / FPS;

describe('frameCount', () => {
  it('counts whole frames', () => {
    expect(frameCount(42, 30)).toBe(1260);
    expect(frameCount(1.01, 30)).toBe(30);
  });
  it('is zero until the duration is known', () => {
    expect(frameCount(NaN, 30)).toBe(0);
    expect(frameCount(0, 30)).toBe(0);
    expect(frameCount(Infinity, 30)).toBe(0);
    expect(frameCount(10, 0)).toBe(0);
  });
});

describe('createPlayer', () => {
  it('seeks to the middle of the frame that holds the time', () => {
    const video = fakeVideo();
    createPlayer(video, FPS).seek(1);
    expect(video.currentTime).toBeCloseTo(middleOf(30), 6);
  });

  it('clamps a seek to the first and last frame', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.seek(99);
    expect(video.currentTime).toBeCloseTo(middleOf(299), 6);
    player.seek(-5);
    expect(video.currentTime).toBeCloseTo(middleOf(0), 6);
  });

  it('does not seek before the duration is known', () => {
    const video = fakeVideo({ duration: NaN, currentTime: 2 });
    createPlayer(video, FPS).seek(5);
    expect(video.currentTime).toBe(2);
  });

  it('steps by whole frames, pausing first, and stops at the edges', () => {
    const video = fakeVideo({ currentTime: middleOf(100), paused: false });
    const player = createPlayer(video, FPS);
    player.step(1);
    expect(video.pause).toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(middleOf(101), 6);
    player.step(-10);
    expect(video.currentTime).toBeCloseTo(middleOf(91), 6);
    player.step(-500);
    expect(video.currentTime).toBeCloseTo(middleOf(0), 6);
  });

  it('plays and pauses', () => {
    const video = fakeVideo({ currentTime: 3 });
    const player = createPlayer(video, FPS);
    player.toggle();
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(3);
    player.toggle();
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it('starts over when play is pressed at the end', () => {
    const video = fakeVideo({ currentTime: 9.99, ended: true });
    createPlayer(video, FPS).toggle();
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalled();
  });

  it('plays a range from its start and stops at its end', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(2, 4, false);
    expect(video.currentTime).toBeCloseTo(middleOf(60), 6);
    expect(video.play).toHaveBeenCalled();

    video.currentTime = 3.5;
    player.tick();
    expect(video.pause).not.toHaveBeenCalled();

    video.currentTime = 4.01;
    player.tick();
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
  });

  it('takes a looping range back to its start and keeps playing', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(2, 4, true);
    video.currentTime = 4.02;
    player.tick();
    expect(video.currentTime).toBeCloseTo(middleOf(60), 6);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
  });

  it('ends a range before the clip does', () => {
    const video = fakeVideo({ duration: 5 });
    const player = createPlayer(video, FPS);
    player.playRange(3, 9, false);
    video.currentTime = 4.9;
    player.tick();
    expect(video.pause).not.toHaveBeenCalled();
    video.currentTime = 4.96;
    player.tick();
    expect(video.pause).toHaveBeenCalled();
  });

  it('forgets the range once the video is paused from outside', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(2, 4, false);
    player.clearRange();
    video.currentTime = 5;
    player.tick();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('does not loop on a range that ends where it starts', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(4, 4, true);
    video.currentTime = 4.02;
    player.tick();
    expect(video.pause).toHaveBeenCalled();
  });
});
