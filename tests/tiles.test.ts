import { describe, expect, it } from 'vitest';
import { ancestors, centre, children, key, kmAcross, neighbours, parent, parse, tileAt } from '../shared/tiles';

describe('tiles', () => {
  it('keys round-trip', () => {
    expect(key({ z: 4, x: 9, y: 5 })).toBe('4/9/5');
    expect(parse('4/9/5')).toEqual({ z: 4, x: 9, y: 5 });
  });

  it('parent of 4/9/5 is 3/4/2, the world has none', () => {
    expect(parent({ z: 4, x: 9, y: 5 })).toEqual({ z: 3, x: 4, y: 2 });
    expect(parent({ z: 0, x: 0, y: 0 })).toBeNull();
  });

  it('children of the world in NW, NE, SW, SE order', () => {
    expect(children({ z: 0, x: 0, y: 0 }).map(key)).toEqual(['1/0/0', '1/1/0', '1/0/1', '1/1/1']);
  });

  it('neighbours wrap x and drop rows off the poles', () => {
    expect(neighbours({ z: 1, x: 0, y: 0 }).map(key).sort()).toEqual(['1/0/1', '1/1/0', '1/1/1']);
    const n = neighbours({ z: 3, x: 0, y: 4 }).map(key);
    expect(n).toContain('3/7/4');
    expect(n).toContain('3/7/3');
    expect(n).toHaveLength(8);
    expect(neighbours({ z: 0, x: 0, y: 0 })).toEqual([]);
  });

  it('finds Chișinău at z12 and measures it', () => {
    const t = tileAt(47.0105, 28.8638, 12);
    expect(t).toEqual({ z: 12, x: 2376, y: 1440 });
    expect(kmAcross(t)).toBeCloseTo(6.7, 0);
    const c = centre(t);
    expect(c.lat).toBeGreaterThan(46.98);
    expect(c.lat).toBeLessThan(47.04);
  });

  it('ancestors are nearest first', () => {
    expect(ancestors({ z: 2, x: 2, y: 1 }).map(key)).toEqual(['1/1/0', '0/0/0']);
  });
});
