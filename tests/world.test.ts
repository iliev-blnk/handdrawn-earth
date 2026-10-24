import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Sql } from '../api/sql';
import { World } from '../api/world';
import fixture from './fixtures/matterhorn.json';

const HOUR = 3_600_000;

function nodeSql(): Sql {
  const db = new DatabaseSync(':memory:');
  return (q, ...a) => db.prepare(q).all(...(a as any[])) as any;
}

function setup(sql = nodeSql()) {
  const clock = { t: Date.UTC(2026, 9, 25, 12) };
  const make = () => new World(sql, () => clock.t, Math.random, () => 1);
  return { w: make(), clock, make };
}

const body = (key: string, token: string) => ({
  key, token, strokes: structuredClone(fixture.strokes),
  duration: fixture.duration, pointer: 'mouse', started: fixture.started,
});

async function leaseOk(w: World, ip: string, key?: string) {
  const l = await w.lease(ip, key);
  if ('error' in l) throw new Error(`lease ${key}: ${l.error}`);
  return l;
}

async function drawAt(w: World, ip: string, key: string) {
  const l = await leaseOk(w, ip, key);
  const r = await w.draw(ip, body(key, l.token));
  if (!('id' in r)) throw new Error(`draw ${key}: ${JSON.stringify(r)}`);
  return r.id;
}

describe('World', () => {
  it('an empty world leases the whole world', async () => {
    const { w } = setup();
    const l = await leaseOk(w, 'a');
    expect(l.key).toBe('0/0/0');
    expect(l.parent).toBeNull();
    expect(l.neighbours).toEqual([]);
    expect(w.hello({}).count).toBe(0);
  });

  it('once 0/0/0 is drawn the next lease is z1, with the parent id', async () => {
    const { w } = setup();
    const id = await drawAt(w, 'a', '0/0/0');
    const l = await leaseOk(w, 'b');
    expect(l.key.startsWith('1/')).toBe(true);
    expect(l.parent).toBe(id);
  });

  it('a square cannot be leased until its parent is drawn', async () => {
    const { w } = setup();
    await drawAt(w, 'a', '0/0/0');
    expect(await w.lease('a', '2/0/0')).toMatchObject({ error: 'draw its parent first' });
    expect(await w.lease('a', '0/0/0')).toMatchObject({ status: 409 });
    expect(await w.lease('a', '17/0/0')).toMatchObject({ status: 400 });
  });

  it('second draw on same key is 409 with a new lease', async () => {
    const { w, clock } = setup();
    await drawAt(w, 'owner', '0/0/0');
    const a = await leaseOk(w, 'a', '1/0/0');
    // b can only take the same square once a's lease has run out
    clock.t += 200_000;
    expect(await drawAt(w, 'b', '1/0/0')).toBeGreaterThan(0);
    const second = await w.draw('a', body('1/0/0', a.token));
    expect(second).toMatchObject({ status: 409 });
    const lease = (second as { lease: { key: string } }).lease;
    expect(lease.key).toMatch(/^[12]\//);
    expect(lease.key).not.toBe('1/0/0');
  });

  it('a retried Keep whose first reply was lost gets its own id back, not a 409', async () => {
    const { w } = setup();
    await drawAt(w, 'owner', '0/0/0');
    const l = await leaseOk(w, 'a', '1/0/0');
    const first = await w.draw('a', body('1/0/0', l.token));
    const again = await w.draw('a', body('1/0/0', l.token));
    expect(again).toEqual(first);
    expect(w.hello({}).count).toBe(2);
  });

  it('a second live lease from the same IP replaces the first', async () => {
    const { w } = setup();
    await drawAt(w, 'owner', '0/0/0');
    await leaseOk(w, 'a', '1/0/0');
    expect(await w.lease('b', '1/0/0')).toMatchObject({ status: 423 });
    await leaseOk(w, 'a', '1/1/0');
    expect((await leaseOk(w, 'b', '1/0/0')).key).toBe('1/0/0');
  });

  it('the 21st draw within an hour is 429', async () => {
    const { w, clock } = setup();
    await drawAt(w, 'owner', '0/0/0');
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) await drawAt(w, 'x', `1/${x}/${y}`);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) await drawAt(w, 'x', `2/${x}/${y}`);
    const l = await leaseOk(w, 'x', '3/0/0');
    expect(await w.draw('x', body('3/0/0', l.token))).toMatchObject({ status: 429 });
    clock.t += HOUR;
    expect(await w.draw('x', body('3/0/0', l.token))).toHaveProperty('id');
  });

  it('three distinct flags hide and reopen the square', async () => {
    const { w } = setup();
    await drawAt(w, 'owner', '0/0/0');
    const id = await drawAt(w, 'owner', '1/0/0');
    await drawAt(w, 'owner', '2/0/0');
    expect(await w.flag('a', id)).toMatchObject({ hidden: false });
    expect(await w.flag('a', id)).toMatchObject({ hidden: false });
    expect(await w.flag('b', id)).toMatchObject({ hidden: false });
    expect(await w.flag('c', id)).toMatchObject({ hidden: true });
    expect(w.index(0).rows.map(r => r[0])).not.toContain(id);
    expect(w.index(id).hidden).toContain(id);
    expect(w.drawing(id)).toBeNull();
    expect(w.hello({}).count).toBe(2);
    // the square is open again; its drawn child stays, its undrawn children lock
    expect((await leaseOk(w, 'd', '1/0/0')).key).toBe('1/0/0');
    expect(await w.lease('e', '2/1/0')).toMatchObject({ error: 'draw its parent first' });
    expect(await w.flag('d', id)).toMatchObject({ status: 404 });
  });

  it('index(since) only returns newer rows', async () => {
    const { w } = setup();
    const a = await drawAt(w, 'o', '0/0/0');
    const b = await drawAt(w, 'o', '1/0/0');
    const c = await drawAt(w, 'o', '1/1/0');
    const all = w.index(0);
    expect(all.rows.map(r => r[0])).toEqual([a, b, c]);
    expect(all.rows[1].slice(1, 4)).toEqual([1, 0, 0]);
    expect(all.count).toBe(3);
    expect(w.index(a).rows.map(r => r[0])).toEqual([b, c]);
    expect(w.index(c).rows).toEqual([]);
  });

  it('pack v equals the max id in the block', async () => {
    const { w } = setup();
    await drawAt(w, 'o', '0/0/0');
    const ids = [];
    for (const k of ['1/0/0', '1/1/0', '1/0/1']) ids.push(await drawAt(w, 'o', k));
    const p = w.pack(1, 0, 0);
    expect(p.v).toBe(Math.max(...ids));
    expect(p.rows.map(r => r.id).sort()).toEqual(ids.sort());
    expect(typeof p.rows[0].d).toBe('string');
    expect(w.pack(2, 0, 0)).toEqual({ v: 0, rows: [] });
  });

  it('an expired lease is accepted if the square is free', async () => {
    const { w, clock } = setup();
    await drawAt(w, 'o', '0/0/0');
    const l = await leaseOk(w, 'a', '1/0/0');
    const other = await leaseOk(w, 'b', '1/1/0');
    clock.t += 200_000;
    expect(await w.draw('a', body('1/0/0', l.token))).toHaveProperty('id');
    // a token only works on the square it was issued for
    expect(await w.draw('b', body('1/0/1', other.token))).toMatchObject({ status: 403 });
  });

  it('leased keys are excluded from queue picks for other IPs', async () => {
    const { w } = setup();
    await drawAt(w, 'o', '0/0/0');
    await leaseOk(w, 'a', '1/0/0');
    await leaseOk(w, 'b', '1/1/0');
    await leaseOk(w, 'c', '1/0/1');
    for (let i = 0; i < 10; i++) expect((await leaseOk(w, 'd')).key).toBe('1/1/1');
    expect(await w.lease('e')).toMatchObject({ status: 503 });
  });

  it('a restarted world rebuilds its index and frontier from storage', async () => {
    const { w, make } = setup();
    const a = await drawAt(w, 'o', '0/0/0');
    await drawAt(w, 'o', '1/0/0');
    const again = make();
    expect(again.index(0)).toEqual(w.index(0));
    expect(again.drawing(a)?.key).toBe('0/0/0');
    expect((await leaseOk(again, 'z', '2/1/1')).key).toBe('2/1/1');
  });
});
