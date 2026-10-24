import { describe, expect, it } from 'vitest';
import { b64, decodeDisplay, decodeStrokes, encodeDisplay, encodeStrokes, simplify, unb64 } from '../shared/codec';
import type { Stroke } from '../shared/types';
import fixture from './fixtures/matterhorn.json';

const strokes = fixture.strokes as Stroke[];
const points = (s: { length: number }[]) => s.reduce((n, x) => n + x.length, 0);

describe('codec', () => {
  it('round-trips the real Matterhorn drawing', () => {
    const bytes = encodeStrokes(strokes);
    const back = decodeStrokes(bytes);
    expect(back).toHaveLength(strokes.length);
    back.forEach((s, i) => s.forEach((p, j) => {
      const q = strokes[i][j];
      expect(Math.abs(p[0] - q[0])).toBeLessThan(1 / 40000);
      expect(Math.abs(p[1] - q[1])).toBeLessThan(1 / 40000);
      expect(p[2]).toBe(q[2]);
    }));
    expect(bytes.length).toBeLessThan(JSON.stringify(strokes).length / 3);
  });

  it('keeps pressure on pen strokes', () => {
    const pen: Stroke[] = [[[0.1, 0.1, 0, 0.5], [0.2, 0.3, 16, 0.75]]];
    expect(decodeStrokes(encodeStrokes(pen))[0][1][3]).toBe(0.75);
  });

  it('display geometry has no timing and at most half the points', () => {
    const d = decodeDisplay(encodeDisplay(strokes));
    expect(d[0][0]).toHaveLength(2);
    expect(points(d)).toBeLessThanOrEqual(points(strokes) / 2);
  });

  it('a single-point stroke survives both formats', () => {
    const dot: Stroke[] = [[[0.5, 0.5, 120]]];
    expect(decodeStrokes(encodeStrokes(dot))[0]).toHaveLength(1);
    expect(decodeDisplay(encodeDisplay(dot))[0]).toHaveLength(1);
  });

  it('coordinates in the margin survive', () => {
    const edge: Stroke[] = [[[-0.05, 1.05, 0], [1.05, -0.05, 10]]];
    const p = decodeStrokes(encodeStrokes(edge))[0];
    expect(p[0][0]).toBeCloseTo(-0.05, 4);
    expect(p[1][0]).toBeCloseTo(1.05, 4);
  });

  it('simplify keeps the endpoints', () => {
    const s = simplify(strokes[0], 0.01);
    expect(s[0]).toEqual(strokes[0][0]);
    expect(s[s.length - 1]).toEqual(strokes[0][strokes[0].length - 1]);
  });

  it('base64 round-trips', () => {
    const bytes = new Uint8Array([0, 1, 254, 255, 128]);
    expect([...unb64(b64(bytes))]).toEqual([...bytes]);
  });
});
