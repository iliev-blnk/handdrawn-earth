import { describe, expect, it } from 'vitest';
import { Frontier } from '../api/frontier';

describe('Frontier', () => {
  it('is empty at first', () => {
    const f = new Frontier();
    expect(f.size).toBe(0);
    expect(f.pick(Math.random)).toBeNull();
  });
  it('never picks a zero-weight key when others exist', () => {
    const f = new Frontier();
    f.add('a', 1); f.add('b', 0);
    for (let i = 0; i < 50; i++) expect(f.pick(Math.random)).toBe('a');
  });
  it('never picks an excluded key', () => {
    const f = new Frontier();
    f.add('a', 1); f.add('b', 1); f.add('c', 1);
    for (let i = 0; i < 50; i++) expect(f.pick(Math.random, new Set(['a', 'c']))).toBe('b');
    expect(f.pick(Math.random, new Set(['a', 'b', 'c']))).toBeNull();
  });
  it('follows the weights', () => {
    const f = new Frontier();
    f.add('a', 3); f.add('b', 1);
    let a = 0, seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) if (f.pick(rand) === 'a') a++;
    expect(a / 4000).toBeGreaterThan(0.7);
    expect(a / 4000).toBeLessThan(0.8);
  });
  it('delete and has', () => {
    const f = new Frontier();
    f.add('a', 1); f.delete('a');
    expect(f.has('a')).toBe(false);
    expect(f.pick(Math.random)).toBeNull();
  });
});
