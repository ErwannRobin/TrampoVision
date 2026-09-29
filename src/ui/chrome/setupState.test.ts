import { describe, expect, it } from 'vitest';
import { setupState, type SetupInputs } from './setupState';

const state = (over: Partial<SetupInputs>) => setupState({ busy: 'idle', hasVideo: true, hasResult: false, ...over });

describe('setupState', () => {
  it('offers to analyze a loaded video that has no result yet', () => {
    expect(state({})).toEqual({
      engineLocked: false,
      calibrationLocked: false,
      canMark: true,
      action: 'analyze',
      actionDisabled: false,
      hint: null,
    });
  });

  it('offers to analyze again over a result', () => {
    const s = state({ hasResult: true });
    expect(s.action).toBe('again');
    expect(s.actionDisabled).toBe(false);
  });

  it('turns the action into Cancel while analyzing, and locks everything but the live settings', () => {
    const s = state({ busy: 'analyzing', hasResult: true });
    expect(s.action).toBe('cancel');
    expect(s.actionDisabled).toBe(false);
    expect(s.engineLocked).toBe(true);
    expect(s.calibrationLocked).toBe(true);
    expect(s.canMark).toBe(false);
  });

  it('keeps the trampoline usable while a video loads, but not the engine or the action', () => {
    const s = state({ busy: 'loading' });
    expect(s.engineLocked).toBe(true);
    expect(s.calibrationLocked).toBe(false);
    expect(s.canMark).toBe(true);
    expect(s.actionDisabled).toBe(true);
    expect(s.hint).toBe('The video is loading.');
  });

  it('cannot mark corners or analyze without a video, and says what to do', () => {
    const fresh = state({ hasVideo: false });
    expect(fresh.canMark).toBe(false);
    expect(fresh.actionDisabled).toBe(true);
    expect(fresh.hint).toBe('Choose a video to analyze.');

    const opened = state({ hasVideo: false, hasResult: true });
    expect(opened.action).toBe('again');
    expect(opened.actionDisabled).toBe(true);
    expect(opened.hint).toMatch(/video that goes with this analysis/);
    expect(opened.calibrationLocked).toBe(false);
  });
});
