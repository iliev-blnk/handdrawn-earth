import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLand } from '../api/land';
import { tileAt } from '../shared/tiles';

const land = createLand(new Uint8Array(readFileSync(new URL('../api/land.bin', import.meta.url))));

describe('land', () => {
  it('the world is about a third land', () => {
    const f = land({ z: 0, x: 0, y: 0 });
    expect(f).toBeGreaterThan(0.25);
    expect(f).toBeLessThan(0.45);
  });
  it('Chișinău is land', () => expect(land(tileAt(47.0105, 28.8638, 12))).toBe(1));
  it('the deep Chișinău squares are land', () => expect(land(tileAt(47.0105, 28.8638, 16))).toBe(1));
  it('the middle of the Pacific is water', () => expect(land(tileAt(-40, -120, 6))).toBe(0));
  it('Antarctica counts for less than its Mercator size', () => {
    expect(land(tileAt(-80, 30, 4))).toBeLessThanOrEqual(0.3);
    expect(land(tileAt(-80, 30, 4))).toBeGreaterThan(0);
  });
});
