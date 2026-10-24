import { describe, expect, it } from 'vitest';
import { key, type Tile } from '../shared/tiles';
import { planTile } from '../src/ink';
import { paintStrokes } from '../src/render';

const T = (z: number, x: number, y: number): Tile => ({ z, x, y });

/** Just enough of a Store: which squares are drawn. */
function drawn(...tiles: Tile[]) {
  const ids = new Map(tiles.map((t, i) => [key(t), i + 1]));
  return {
    nearestDrawn(t: Tile) {
      for (let a: Tile | null = t; a; a = a.z ? T(a.z - 1, a.x >> 1, a.y >> 1) : null) {
        const id = ids.get(key(a));
        if (id) return { tile: a, id };
      }
      return null;
    },
  };
}

/** Records path calls and every coordinate handed to the canvas. */
function recorder(size = 1024) {
  const calls: string[] = [], coords: number[] = [];
  const rec = (name: string) => (...a: number[]) => { calls.push(name); coords.push(...a.slice(0, 4)); };
  const ctx = {
    canvas: { width: size, height: size },
    getTransform: () => ({ a: 1 }),
    save() {}, restore() {}, beginPath() {}, stroke() { calls.push('stroke'); }, fill() {},
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), quadraticCurveTo: rec('quad'), arc: rec('arc'),
    set strokeStyle(_: string) {}, set fillStyle(_: string) {}, set lineWidth(_: number) {},
    set lineCap(_: string) {}, set lineJoin(_: string) {}, set globalAlpha(_: number) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, coords };
}

describe('planTile', () => {
  it('a drawn square paints itself', () => {
    expect(planTile(T(2, 2, 1), drawn(T(0, 0, 0), T(2, 2, 1)))).toEqual({ kind: 'own', tile: T(2, 2, 1) });
  });

  it('an undrawn square crops its nearest drawn ancestor', () => {
    expect(planTile(T(2, 2, 1), drawn(T(0, 0, 0)))).toEqual({ kind: 'ancestor', tile: T(0, 0, 0), ox: -2, oy: -1, scale: 4 });
    expect(planTile(T(3, 5, 2), drawn(T(0, 0, 0), T(1, 1, 0)))).toEqual({ kind: 'ancestor', tile: T(1, 1, 0), ox: -1, oy: -2, scale: 4 });
  });

  it('nothing drawn above it: nothing to paint', () => {
    expect(planTile(T(2, 2, 1), drawn())).toEqual({ kind: 'none' });
  });
});

describe('paintStrokes', () => {
  const zigzag: [number, number][] = Array.from({ length: 40 }, (_, i) => [i / 39, i % 2 ? 0.2 : 0.8]);

  it('paints a whole stroke at its own scale', () => {
    const { ctx, calls } = recorder();
    paintStrokes(ctx, [zigzag], 0, 0, 1024, { width: 4.8, color: '#000' });
    expect(calls.filter(c => c === 'quad').length).toBeGreaterThan(30);
    expect(calls.filter(c => c === 'stroke')).toHaveLength(1);
  });

  it('a deep crop of an ancestor hands the canvas only nearby, small coordinates', () => {
    // z0 drawing seen from a z16 square in the middle of it: 65536× bigger than the tile.
    const { ctx, calls, coords } = recorder();
    const scale = 2 ** 16, t = { x: 32767, y: 13107 };
    const line: [number, number][] = [[0, 0.2], [0.3, 0.2], [0.5, 0.2], [1, 0.2]];
    paintStrokes(ctx, [line, zigzag], -t.x * 1024, -t.y * 1024, scale * 1024, { width: 4.8, color: '#000' });
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) expect(Math.abs(c)).toBeLessThan(2e4);
    expect(calls.filter(c => c === 'quad').length).toBeLessThan(200);
  });

  it('upTo replays only the part drawn so far', () => {
    const timed = zigzag.map(([x, y], i) => [x, y, i * 100] as [number, number, number]);
    const a = recorder(), b = recorder();
    paintStrokes(a.ctx, [timed], 0, 0, 1024, { width: 4.8, color: '#000', upTo: 1000 });
    paintStrokes(b.ctx, [timed], 0, 0, 1024, { width: 4.8, color: '#000' });
    expect(a.calls.filter(c => c === 'quad').length).toBeLessThan(b.calls.filter(c => c === 'quad').length / 2);
  });
});
