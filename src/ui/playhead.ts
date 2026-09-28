import { useSyncExternalStore } from 'react';

/**
 * Tiny external store for the current video time so that the charts, metrics and overlay can
 * follow playback at frame rate without re-rendering the whole React tree.
 */
export class Playhead {
  private t = 0;
  private listeners = new Set<() => void>();
  /** Installed by the player: performs an actual seek on the <video>. */
  seekHandler: ((time: number) => void) | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.t;

  setTime(t: number) {
    if (t === this.t) return;
    this.t = t;
    this.listeners.forEach((l) => l());
  }
  seek(t: number) {
    this.seekHandler?.(t);
  }
}

export const usePlayheadTime = (p: Playhead) => useSyncExternalStore(p.subscribe, p.getSnapshot);
