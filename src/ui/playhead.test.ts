import { describe, expect, it, vi } from 'vitest';
import { Playhead } from './playhead';

/** A playhead whose stage plays ranges and pauses like the real one: `playing` follows what the handlers do. */
function stagePlayhead() {
  const p = new Playhead();
  p.playRangeHandler = () => p.setPlaying(true);
  p.toggleHandler = () => p.setPlaying(!p.getPlaying());
  p.pauseHandler = () => p.setPlaying(false);
  p.stepHandler = () => p.setPlaying(false);
  p.reverseHandler = () => p.setPlaying(true);
  return p;
}

describe('the button that started a range', () => {
  it('is known while the range plays', () => {
    const p = stagePlayhead();
    p.claim('timeline');
    p.playRange(1, 2);
    p.claim(null);
    expect(p.getPlaying()).toBe(true);
    expect(p.getRangeKey()).toBe('timeline');
  });

  it('goes to the next button that starts a range, without a pause in between', () => {
    const p = stagePlayhead();
    p.claim('timeline');
    p.playRange(1, 2);
    p.claim('skill');
    p.playRange(3, 4);
    expect(p.getRangeKey()).toBe('skill');
    expect(p.getPlaying()).toBe(true);
  });

  it('is nobody for a range that no button claimed', () => {
    const p = stagePlayhead();
    p.claim('timeline');
    p.playRange(1, 2);
    p.playRange(3, 4);
    expect(p.getRangeKey()).toBeNull();
  });

  it('is released by a pause, a toggle, a step, a reverse and by the end of the clip', () => {
    const release: Record<string, (p: Playhead) => void> = {
      pause: (p) => p.pause(),
      toggle: (p) => p.toggle(),
      step: (p) => p.step(1),
      reverse: (p) => p.reverse(),
      end: (p) => p.setPlaying(false),
    };
    for (const [name, act] of Object.entries(release)) {
      const p = stagePlayhead();
      p.claim('timeline');
      p.playRange(1, 2);
      act(p);
      expect(p.getRangeKey(), name).toBeNull();
    }
  });

  it('tells the listeners when it changes', () => {
    const p = stagePlayhead();
    const listener = vi.fn();
    p.subscribeState(listener);
    p.claim('timeline');
    p.playRange(1, 2);
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    p.pause();
    expect(listener).toHaveBeenCalled();
  });
});
