import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, Autosaver, type SetSnapshot, type SetWriter } from './autosave';
import type { SavedSet, SetSummary } from './store';

/** A writer that remembers what it was asked to write, and can be told to fail. */
function writer() {
  const saves: SavedSet[] = [];
  const updates: SetSummary[] = [];
  const w = {
    saves,
    updates,
    fail: false,
    stored: true,
    async save(set: SavedSet) {
      if (w.fail) return false;
      saves.push(set);
      return true;
    },
    async update(summary: SetSummary) {
      if (w.fail) throw new Error('quota');
      updates.push(summary);
      return w.stored;
    },
  };
  return w satisfies SetWriter & object;
}

const track = {};
const snap = (over: Partial<SetSnapshot> = {}): SetSnapshot => ({
  id: 'v-1',
  fileName: 'clip.mp4',
  track,
  settingsKey: 'h1.75',
  skills: 6,
  pending: 1,
  difficulty: 4.2,
  jumps: 9,
  serialize: () => '{"series":true}',
  ...over,
});

const settle = () => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('autosaving the set on screen', () => {
  it('writes the whole set once the analysis has settled', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    expect(w.saves).toHaveLength(0);
    await settle();
    expect(w.saves).toHaveLength(1);
    expect(w.saves[0]).toMatchObject({
      id: 'v-1',
      fileName: 'clip.mp4',
      skills: 6,
      pending: 1,
      difficulty: 4.2,
      jumps: 9,
    });
    expect(w.saves[0].series).toBe('{"series":true}');
    expect(w.updates).toHaveLength(0);
  });

  it('writes nothing again for the same screen', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await settle();
    saver.update(snap());
    await settle();
    expect(w.saves).toHaveLength(1);
    expect(w.updates).toHaveLength(0);
  });

  it('writes only the line when the coach changes a skill: the series is not made again', async () => {
    const w = writer();
    const serialize = vi.fn(() => '{}');
    const saver = new Autosaver(w);
    saver.update(snap({ serialize }));
    await settle();
    saver.update(snap({ serialize, skills: 7, pending: 0, difficulty: 4.8 }));
    await settle();
    expect(w.saves).toHaveLength(1);
    expect(w.updates).toHaveLength(1);
    expect(w.updates[0]).toMatchObject({ id: 'v-1', skills: 7, pending: 0, difficulty: 4.8 });
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it('writes the whole set again when the settings change, or when it is a new analysis', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await settle();
    saver.update(snap({ settingsKey: 'h1.80' }));
    await settle();
    expect(w.saves).toHaveLength(2);
    saver.update(snap({ settingsKey: 'h1.80', track: {} }));
    await settle();
    expect(w.saves).toHaveLength(3);
    expect(w.updates).toHaveLength(0);
  });

  it('waits for the screen to settle: a height typed digit by digit is one write', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap({ settingsKey: 'a' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    saver.update(snap({ settingsKey: 'b' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    saver.update(snap({ settingsKey: 'c' }));
    await settle();
    expect(w.saves).toHaveLength(1);
  });

  it('writes the whole set again when the stored one is gone', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await settle();
    w.stored = false;
    saver.update(snap({ skills: 5 }));
    await settle();
    expect(w.updates).toHaveLength(1);
    expect(w.saves).toHaveLength(2);
    expect(w.saves[1].skills).toBe(5);
  });

  it('does not write what it is not asked to: nothing on screen, nothing written', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(null);
    await settle();
    expect(w.saves).toHaveLength(0);
    expect(await saver.flush()).toBe(false);
  });

  it('still writes a correction when the next clip is opened a moment later', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await vi.advanceTimersByTimeAsync(100);
    saver.update(null);
    await settle();
    expect(w.saves).toHaveLength(1);
  });
});

describe('leaving the set', () => {
  it('flushes at once what is waiting, and says it is stored', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    expect(await saver.flush()).toBe(true);
    expect(w.saves).toHaveLength(1);
    await settle();
    expect(w.saves).toHaveLength(1);
  });

  it('answers at once when the set is already stored', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await settle();
    expect(await saver.flush()).toBe(true);
    expect(w.saves).toHaveLength(1);
  });

  it('says so when the write failed, and tries again the next time', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    w.fail = true;
    expect(await saver.flush()).toBe(false);
    w.fail = false;
    expect(await saver.flush()).toBe(true);
    expect(w.saves).toHaveLength(1);
  });

  it('says so when the write throws', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.update(snap());
    await settle();
    w.fail = true;
    saver.update(snap({ skills: 2 }));
    expect(await saver.flush()).toBe(false);
  });

  it('writes one set at a time, in order', async () => {
    const order: string[] = [];
    const w = writer();
    const slow: SetWriter = {
      save: async (set) => {
        order.push(`start ${set.skills}`);
        await new Promise((r) => setTimeout(r, 50));
        order.push(`end ${set.skills}`);
        return w.save(set);
      },
      update: (s) => w.update(s),
    };
    const saver = new Autosaver(slow);
    saver.update(snap({ skills: 1 }));
    const first = saver.flush();
    saver.update(snap({ skills: 2, track: {} }));
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });
});

describe('a set opened from the list', () => {
  const stored: SetSummary = {
    id: 'v-1',
    fileName: 'clip.mp4',
    savedAt: '2026-01-01T00:00:00.000Z',
    skills: 6,
    pending: 1,
    difficulty: 4.2,
    jumps: 9,
  };

  it('is already stored: opening it writes nothing, and leaving it does not wait for a write', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.adopt(stored, track);
    saver.update(snap());
    await settle();
    expect(w.saves).toHaveLength(0);
    expect(w.updates).toHaveLength(0);
    expect(await saver.flush()).toBe(true);
    expect(w.saves).toHaveLength(0);
  });

  it('writes only the line when its labels say something else than the list did', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.adopt(stored, track);
    saver.update(snap({ skills: 7, pending: 0 }));
    await settle();
    expect(w.saves).toHaveLength(0);
    expect(w.updates).toHaveLength(1);
    expect(w.updates[0]).toMatchObject({ skills: 7, pending: 0 });
  });

  it('writes the whole set once a setting changes', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.adopt(stored, track);
    saver.update(snap());
    await settle();
    saver.update(snap({ settingsKey: 'h1.90' }));
    await settle();
    expect(w.saves).toHaveLength(1);
  });

  it('is forgotten when the set is closed', async () => {
    const w = writer();
    const saver = new Autosaver(w);
    saver.adopt(stored, track);
    saver.reset();
    saver.update(snap());
    await settle();
    expect(w.saves).toHaveLength(1);
  });
});
