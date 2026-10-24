import { describe, expect, it } from 'vitest';
import { b64, encodeDisplay } from '../shared/codec';
import { createApi } from '../src/api';
import { Store } from '../src/store';

const NOW = Date.UTC(2026, 9, 25, 12);
const sec = (ms: number) => Math.floor(ms / 1000);
const line = b64(encodeDisplay([[[0, 0, 0], [1, 1, 10]]]));

/** A fake API server: routes by path, counts calls. */
function fake(routes: Record<string, (url: URL) => unknown>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const route = Object.keys(routes).find(p => url.pathname.startsWith(p));
    if (!route) return new Response('{"error":"not found"}', { status: 404 });
    await Promise.resolve();
    return Response.json(routes[route](url));
  }) as typeof fetch;
  return { api: createApi('http://api.test', fetchImpl), calls };
}

const T = (z: number, x: number, y: number) => ({ z, x, y });

async function loaded(rows: number[][], extra: Record<string, (url: URL) => unknown> = {}) {
  const f = fake({ '/index': () => ({ rows, hidden: [], count: rows.length }), ...extra });
  const store = new Store(f.api, () => NOW);
  await store.load();
  return { store, calls: f.calls };
}

describe('Store', () => {
  it('nearestDrawn returns the tile itself, then its parent, then null', async () => {
    const { store } = await loaded([[1, 0, 0, 0, sec(NOW)], [2, 1, 0, 0, sec(NOW)]]);
    expect(store.nearestDrawn(T(1, 0, 0))).toEqual({ tile: T(1, 0, 0), id: 2 });
    expect(store.nearestDrawn(T(2, 1, 1))).toEqual({ tile: T(1, 0, 0), id: 2 });
    expect(store.nearestDrawn(T(3, 7, 0))).toEqual({ tile: T(0, 0, 0), id: 1 });
    const empty = (await loaded([])).store;
    expect(empty.nearestDrawn(T(3, 7, 0))).toBeNull();
    expect(store.count).toBe(2);
  });

  it('isFrontier is true for undrawn children of drawn tiles only', async () => {
    const { store } = await loaded([[1, 0, 0, 0, 0], [2, 1, 0, 0, 0]]);
    expect(store.isFrontier(T(1, 1, 0))).toBe(true);
    expect(store.isFrontier(T(2, 1, 1))).toBe(true);
    expect(store.isFrontier(T(2, 2, 0))).toBe(false);
    expect(store.isFrontier(T(1, 0, 0))).toBe(false);
    expect((await loaded([])).store.isFrontier(T(0, 0, 0))).toBe(true);
  });

  it('poll adds newer rows, drops hidden ones and reports changed keys', async () => {
    let since = '';
    const f = fake({
      '/index': url => {
        since = url.searchParams.get('since')!;
        return since === '0'
          ? { rows: [[1, 0, 0, 0, 0], [2, 1, 0, 0, 0]], hidden: [], count: 2 }
          : { rows: [[3, 1, 1, 0, 0]], hidden: [2], count: 2 };
      },
    });
    const store = new Store(f.api, () => NOW);
    await store.load();
    const changed = await store.poll();
    expect(since).toBe('2');
    expect(changed.sort()).toEqual(['1/0/0', '1/1/0']);
    expect(store.isDrawn(T(1, 0, 0))).toBe(false);
    expect(store.isDrawn(T(1, 1, 0))).toBe(true);
    expect(store.idOf(T(1, 1, 0))).toBe(3);
    expect(store.keyOf(3)).toBe('1/1/0');
  });

  it('packFor fetches a block once at its newest id and keeps only rows the index knows', async () => {
    const { store, calls } = await loaded([[1, 0, 0, 0, 0], [4, 1, 0, 0, 0], [5, 1, 1, 1, 0]], {
      '/pack/1/0/0': () => ({ v: 9, rows: [{ id: 4, x: 0, y: 0, d: line }, { id: 5, x: 1, y: 1, d: line }, { id: 9, x: 1, y: 0, d: line }] }),
    });
    const [a, b] = await Promise.all([store.packFor(T(1, 0, 0)), store.packFor(T(1, 1, 1))]);
    expect(a).toBe(b);
    expect([...a.keys()].sort()).toEqual(['1/0/0', '1/1/1']);
    expect(a.get('1/0/0')).toEqual([[[0, 0], [1, 1]]]);
    expect(calls.filter(c => c.startsWith('/pack'))).toEqual(['/pack/1/0/0?v=5']);
    expect(await store.displayFor(T(1, 1, 1))).toEqual([[[0, 0], [1, 1]]]);
    // a block with nothing drawn costs no request
    expect((await store.packFor(T(4, 9, 9))).size).toBe(0);
    expect(calls.filter(c => c.startsWith('/pack'))).toHaveLength(1);
  });

  it('recent means drawn in the last 24 hours', async () => {
    const { store } = await loaded([[1, 0, 0, 0, sec(NOW - 3_600_000)], [2, 1, 0, 0, sec(NOW - 25 * 3_600_000)]]);
    expect(store.recent(T(0, 0, 0))).toBe(true);
    expect(store.recent(T(1, 0, 0))).toBe(false);
    expect(store.recent(T(1, 1, 0))).toBe(false);
  });

  it('a square saved here shows up before the next poll', async () => {
    const { store } = await loaded([[1, 0, 0, 0, 0]]);
    expect(store.addSaved(7, T(1, 0, 1))).toEqual(['1/0/1']);
    expect(store.nearestDrawn(T(2, 0, 3))).toEqual({ tile: T(1, 0, 1), id: 7 });
    expect(store.count).toBe(2);
    expect(store.recent(T(1, 0, 1))).toBe(true);
  });
});
