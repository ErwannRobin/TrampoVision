import { describe, expect, it } from 'vitest';
import { DB_VERSION, STORE_RECORDS, STORE_SET_DATA, STORE_SETS, upgradeSchema, type SchemaDb } from '../dataset/db';
import { createMemoryHistory, evictions, HISTORY_LIMIT, newestFirst, type SavedSet, type SetSummary } from './store';

const DAY = 24 * 3600 * 1000;
const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString();
const set = (id: string, day: number, over: Partial<SavedSet> = {}): SavedSet => ({
  id,
  fileName: `${id}.mp4`,
  savedAt: at(day),
  skills: 6,
  pending: 1,
  difficulty: 4.2,
  jumps: 9,
  series: `{"series":"${id}"}`,
  ...over,
});

describe('the recent sets store', () => {
  it('keeps sets, lists them newest first without their analysis, and reads one back with it', async () => {
    const store = createMemoryHistory();
    await store.put(set('a', 1));
    await store.put(set('b', 3));
    await store.put(set('c', 2));
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(list.every((s) => !('series' in s))).toBe(true);
    expect(await store.get('c')).toEqual(set('c', 2));
    expect(await store.get('missing')).toBeNull();
  });

  it('replaces the set of the same video instead of adding a second one', async () => {
    const store = createMemoryHistory();
    await store.put(set('a', 1));
    await store.put(set('a', 5, { skills: 8, series: 'new' }));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', skills: 8, savedAt: at(5) });
    expect((await store.get('a'))?.series).toBe('new');
  });

  it('updates the line of a set and leaves its analysis alone, and says when there is no such set', async () => {
    const store = createMemoryHistory();
    await store.put(set('a', 1));
    const { series: _series, ...line } = set('a', 4, { skills: 7, difficulty: 5.1 });
    expect(await store.update(line)).toBe(true);
    expect(await store.get('a')).toEqual(set('a', 4, { skills: 7, difficulty: 5.1, series: set('a', 1).series }));
    expect(await store.update({ ...line, id: 'nope' })).toBe(false);
    expect(await store.list()).toHaveLength(1);
  });

  it('removes one set and clears them all', async () => {
    const store = createMemoryHistory([set('a', 1), set('b', 2), set('c', 3)]);
    await store.remove('b');
    expect((await store.list()).map((s) => s.id)).toEqual(['c', 'a']);
    expect(await store.get('b')).toBeNull();
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await store.get('a')).toBeNull();
  });

  it('keeps at most 20 sets and lets the oldest go, analysis included', async () => {
    const store = createMemoryHistory();
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) await store.put(set(`s${i}`, i));
    const list = await store.list();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].id).toBe(`s${HISTORY_LIMIT + 2}`);
    expect(list.map((s) => s.id)).not.toContain('s0');
    expect(list.map((s) => s.id)).not.toContain('s2');
    expect(list.map((s) => s.id)).toContain('s3');
    expect(await store.get('s0')).toBeNull();
  });

  it('keeps the set that was just written even when its date is the oldest', async () => {
    const store = createMemoryHistory();
    for (let i = 1; i <= HISTORY_LIMIT; i++) await store.put(set(`s${i}`, i + 10));
    await store.put(set('old', 0));
    const ids = (await store.list()).map((s) => s.id);
    expect(ids).toHaveLength(HISTORY_LIMIT);
    expect(ids).toContain('old');
    expect(ids).not.toContain('s1');
  });

  it('keeps an updated set: a correction makes it the newest', async () => {
    const store = createMemoryHistory();
    for (let i = 0; i < HISTORY_LIMIT; i++) await store.put(set(`s${i}`, i));
    const { series: _series, ...line } = set('s0', 100);
    await store.update(line);
    await store.put(set('fresh', 50));
    const ids = (await store.list()).map((s) => s.id);
    expect(ids).toContain('s0');
    expect(ids).not.toContain('s1');
  });
});

describe('which sets to evict', () => {
  const list: SetSummary[] = [set('a', 1), set('b', 4), set('c', 2), set('d', 3)];

  it('names the oldest ones past the limit', () => {
    expect(evictions(list, 2)).toEqual(['c', 'a']);
    expect(evictions(list, 4)).toEqual([]);
    expect(evictions(list, 10)).toEqual([]);
  });

  it('never names the set to keep', () => {
    expect(evictions(list, 2, 'a')).toEqual(['d', 'c']);
  });

  it('orders equal dates by id, so the choice does not depend on the order of the store', () => {
    const tie = [set('b', 1), set('a', 1)];
    expect([...tie].sort(newestFirst).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

/** A database that only remembers which stores exist: enough to see what an upgrade creates and leaves alone. */
function fakeDb(existing: string[]) {
  const stores = new Set(existing);
  const created: string[] = [];
  const db: SchemaDb = {
    objectStoreNames: { contains: (name: string) => stores.has(name) } as DOMStringList,
    createObjectStore: (name: string) => {
      if (stores.has(name)) throw new Error(`store ${name} already exists`);
      stores.add(name);
      created.push(name);
      return {} as IDBObjectStore;
    },
  };
  return { db, created, stores };
}

describe('the database upgrade', () => {
  it('is the second version of the database', () => {
    expect(DB_VERSION).toBe(2);
  });

  it('adds the recent sets to a database that holds the jump records, and leaves the records alone', () => {
    const { db, created, stores } = fakeDb([STORE_RECORDS]);
    upgradeSchema(db);
    expect(created).toEqual([STORE_SETS, STORE_SET_DATA]);
    expect(stores.has(STORE_RECORDS)).toBe(true);
  });

  it('creates every store in a new database', () => {
    const { db, created } = fakeDb([]);
    upgradeSchema(db);
    expect(created.sort()).toEqual([STORE_RECORDS, STORE_SETS, STORE_SET_DATA].sort());
  });

  it('does nothing to a database that is up to date', () => {
    const { db, created } = fakeDb([STORE_RECORDS, STORE_SETS, STORE_SET_DATA]);
    upgradeSchema(db);
    expect(created).toEqual([]);
  });
});
