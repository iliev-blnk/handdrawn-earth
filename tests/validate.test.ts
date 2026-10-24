import { describe, expect, it } from 'vitest';
import { validateDrawing } from '../shared/validate';
import fixture from './fixtures/matterhorn.json';

const good = () => ({
  key: '11/1067/728', token: 'tok-0123456789', strokes: structuredClone(fixture.strokes),
  duration: fixture.duration, pointer: 'mouse', started: fixture.started,
});
const err = (patch: (b: any) => void) => {
  const b: any = good(); patch(b);
  const r = validateDrawing(b);
  return r.ok ? null : r.error;
};

describe('validateDrawing', () => {
  it('accepts the real Matterhorn drawing', () => {
    const r = validateDrawing(good());
    expect(r.ok).toBe(true);
  });
  it('rejects fewer than 10 points', () => expect(err(b => { b.strokes = [[[0.1, 0.1, 0], [0.2, 0.2, 5]]]; })).toMatch(/points/));
  it('rejects a coordinate of 1.2', () => expect(err(b => { b.strokes[0][3][0] = 1.2; })).toMatch(/outside/));
  it('rejects time going backwards', () => expect(err(b => { b.strokes[0][5][2] = 0; })).toMatch(/time/));
  it('rejects t past 61 s', () => expect(err(b => { b.strokes[6].at(-1)[2] = 61001; })).toMatch(/time/));
  it('rejects a duration past 61 s', () => expect(err(b => { b.duration = 61001; })).toMatch(/duration/));
  it('rejects 401 strokes', () => expect(err(b => { b.strokes = Array.from({ length: 401 }, (_, i) => [[0.5, 0.5, i]]); })).toMatch(/strokes/));
  it('rejects more than 20,000 points', () => expect(err(b => { b.strokes = [Array.from({ length: 20001 }, (_, i) => [0.5, 0.5, Math.floor(i / 400)])]; })).toMatch(/points/));
  it('rejects z17', () => expect(err(b => { b.key = '17/0/0'; })).toMatch(/square/));
  it('rejects a key out of range at its zoom', () => expect(err(b => { b.key = '2/4/0'; })).toMatch(/square/));
  it('rejects junk keys', () => expect(err(b => { b.key = 'a/b/c'; })).toMatch(/square/));
  it('rejects a robot pointer', () => expect(err(b => { b.pointer = 'robot'; })).toMatch(/pointer/));
  it('rejects non-numeric points', () => expect(err(b => { b.strokes[0][1] = ['x', 0, 1]; })).toMatch(/point/));
  it('rejects a missing token', () => expect(err(b => { delete b.token; })).toMatch(/token/));
  it('rejects a body that is not an object', () => expect(validateDrawing(null).ok).toBe(false));
});
