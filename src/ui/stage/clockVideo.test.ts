import { describe, expect, it, vi } from 'vitest';
import { createClockVideo } from './clockVideo';
import { createPlayer } from './player';

const FPS = 30;

describe('createClockVideo', () => {
  it('only moves while playing, and reports play and pause', () => {
    const onPlaying = vi.fn();
    const clock = createClockVideo(2, onPlaying);
    clock.advance(1);
    expect(clock.currentTime).toBe(0);
    clock.play();
    clock.advance(0.5);
    expect(clock.currentTime).toBeCloseTo(0.5);
    clock.pause();
    clock.advance(1);
    expect(clock.currentTime).toBeCloseTo(0.5);
    expect(onPlaying.mock.calls).toEqual([[true], [false]]);
  });

  it('stops at the end and is then ended', () => {
    const clock = createClockVideo(1, () => undefined);
    clock.play();
    clock.advance(5);
    expect(clock.currentTime).toBe(1);
    expect(clock.paused).toBe(true);
    expect(clock.ended).toBe(true);
  });

  it('is driven by the player: pressing play at the end starts over', () => {
    const clock = createClockVideo(1, () => undefined);
    const player = createPlayer(clock, FPS);
    player.toggle();
    clock.advance(5);
    player.toggle();
    expect(clock.paused).toBe(false);
    expect(clock.currentTime).toBe(0);
  });

  it('plays a range and stops at its end', () => {
    const clock = createClockVideo(10, () => undefined);
    const player = createPlayer(clock, FPS);
    player.playRange(2, 3, false);
    expect(clock.paused).toBe(false);
    clock.advance(1.2);
    player.tick();
    expect(clock.paused).toBe(true);
  });
});
