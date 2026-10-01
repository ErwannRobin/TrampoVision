import { describe, expect, it, vi } from 'vitest';
import { createPlayer, frameCount } from './player';

/** A video that only remembers what it was told: 10 s long, paused at the start. */
function fakeVideo(
  over: { duration?: number; currentTime?: number; paused?: boolean; ended?: boolean; seeking?: boolean } = {},
) {
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

  it('a boomerang range goes back to its start after the end, and stops there', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(2, 4, false, true);
    video.currentTime = 4.01;
    player.tick(0);
    expect(player.isReversing()).toBe(true);
    for (let i = 0; i < 20; i++) player.tick(i * 1000);
    expect(player.isReversing()).toBe(false);
    expect(video.currentTime).toBeCloseTo(middleOf(60), 6);
    expect(video.paused).toBe(true);
  });

  it('a looping boomerang plays forward again once it is back', () => {
    const video = fakeVideo();
    const player = createPlayer(video, FPS);
    player.playRange(2, 4, true, true);
    video.currentTime = 4.01;
    player.tick(0);
    for (let i = 0; i < 20; i++) player.tick(i * 1000);
    expect(player.isReversing()).toBe(false);
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

describe('reverse play', () => {
  /** A player at 1 s into the clip that is playing backwards, and a way to say how many seconds went by. */
  function reversing(over: Parameters<typeof fakeVideo>[0] = {}, rate = 1) {
    const video = fakeVideo({ currentTime: middleOf(30), ...over });
    const states: boolean[] = [];
    const player = createPlayer(video, FPS, { rate: () => rate, onReverse: (a) => states.push(a) });
    player.reverse();
    let now = 1000;
    player.tick(now); // the first tick only starts the clock
    return {
      video,
      player,
      states,
      /** Time goes by in animation frames of 20 ms. */
      after: (seconds: number) => {
        for (let i = 0; i < Math.round(seconds / 0.02); i++) {
          now += 20;
          player.tick(now);
        }
      },
    };
  }

  it('pauses the video and walks it back at the playback speed', () => {
    const { video, player, states, after } = reversing();
    expect(video.pause).toHaveBeenCalled();
    expect(states).toEqual([true]);
    expect(player.isReversing()).toBe(true);
    after(0.5);
    expect(video.currentTime).toBeCloseTo(middleOf(15), 6);
    after(0.2);
    expect(video.currentTime).toBeCloseTo(middleOf(9), 6);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('follows the speed that is chosen', () => {
    const { video, after } = reversing({}, 0.5);
    after(0.5);
    expect(video.currentTime).toBeCloseTo(middleOf(23), 6);
  });

  it('keeps time while the decoder is busy instead of falling behind', () => {
    const { video, after } = reversing({ seeking: true });
    after(0.3);
    expect(video.currentTime).toBeCloseTo(middleOf(30), 6);
    video.seeking = false;
    after(0.1);
    expect(video.currentTime).toBeCloseTo(middleOf(18), 6);
  });

  it('does not seek again for a frame it already shows', () => {
    const { video, after } = reversing();
    const before = video.currentTime;
    after(0.001);
    expect(video.currentTime).toBe(before);
  });

  it('stops on the first frame', () => {
    const { video, player, states, after } = reversing({ currentTime: middleOf(3) });
    after(0.5);
    expect(video.currentTime).toBeCloseTo(middleOf(0), 6);
    expect(player.isReversing()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('starts over from the last frame when it is asked for on the first one', () => {
    const video = fakeVideo({ currentTime: middleOf(0) });
    const player = createPlayer(video, FPS);
    player.reverse();
    expect(video.currentTime).toBeCloseTo(middleOf(299), 6);
    expect(player.isReversing()).toBe(true);
  });

  it('stops when it is asked again, on pause, on a toggle, a step and a seek', () => {
    const asks: ((p: ReturnType<typeof createPlayer>) => void)[] = [
      (p) => p.reverse(),
      (p) => p.pause(),
      (p) => p.toggle(),
      (p) => p.step(1),
      (p) => p.seek(2),
      (p) => p.playRange(2, 3, false),
    ];
    for (const ask of asks) {
      const { player, states } = reversing();
      ask(player);
      expect(player.isReversing()).toBe(false);
      expect(states).toEqual([true, false]);
    }
  });

  it('a toggle while going back only stops: it does not start playing forward', () => {
    const { video, player } = reversing();
    player.toggle();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('does nothing before the duration is known', () => {
    const video = fakeVideo({ duration: NaN });
    const player = createPlayer(video, FPS);
    player.reverse();
    expect(player.isReversing()).toBe(false);
  });
});
