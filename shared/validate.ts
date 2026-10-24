import { isTile, parse } from './tiles';
import type { DrawingIn, Point, PointerKind, Stroke } from './types';

export const LIMIT_MS = 60_000;
export const SLACK_MS = 1_000;
export const MAX_STROKES = 400;
export const MAX_POINTS = 20_000;
export const MIN_POINTS = 10;
const LO = -0.05, HI = 1.05;
const POINTERS: PointerKind[] = ['mouse', 'pen', 'touch'];

type Result = { ok: true; value: DrawingIn } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

export const KEY_RE = /^\d{1,2}\/\d{1,6}\/\d{1,6}$/;

export function validKey(k: unknown): k is string {
  return typeof k === 'string' && KEY_RE.test(k) && isTile(parse(k));
}

export function validateDrawing(body: unknown): Result {
  if (!body || typeof body !== 'object') return fail('not a drawing');
  const b = body as Record<string, unknown>;
  if (!validKey(b.key)) return fail('no such square');
  if (typeof b.token !== 'string' || b.token.length < 8 || b.token.length > 64) return fail('missing token');
  if (!POINTERS.includes(b.pointer as PointerKind)) return fail('unknown pointer');
  if (typeof b.duration !== 'number' || !Number.isFinite(b.duration) || b.duration < 0 || b.duration > LIMIT_MS + SLACK_MS)
    return fail('duration out of range');
  const started = typeof b.started === 'string' && b.started.length <= 40 ? b.started : '';
  if (!Array.isArray(b.strokes) || b.strokes.length === 0) return fail('no strokes');
  if (b.strokes.length > MAX_STROKES) return fail('too many strokes');

  const strokes: Stroke[] = [];
  let total = 0, last = 0;
  for (const s of b.strokes) {
    if (!Array.isArray(s) || s.length === 0) return fail('empty stroke');
    total += s.length;
    if (total > MAX_POINTS) return fail('too many points');
    const out: Point[] = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length < 3 || p.length > 4 || !p.every(v => typeof v === 'number' && Number.isFinite(v)))
        return fail('bad point');
      const [x, y, t, pressure] = p as number[];
      if (x < LO || x > HI || y < LO || y > HI) return fail('point outside the square');
      if (t < last || t > LIMIT_MS + SLACK_MS) return fail('time out of order');
      last = t;
      if (pressure !== undefined && (pressure < 0 || pressure > 1)) return fail('bad pressure');
      out.push(pressure === undefined ? [x, y, t] : [x, y, t, pressure]);
    }
    strokes.push(out);
  }
  if (total < MIN_POINTS) return fail('too few points');
  return {
    ok: true,
    value: { key: b.key, token: b.token, strokes, duration: Math.round(b.duration), pointer: b.pointer as PointerKind, started },
  };
}
