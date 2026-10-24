import type { DisplayStroke, Point, Stroke } from './types';

// Byte format, version 1:
//   u8 version, u8 flags (bit1: no timing)
//   varint stroke count, then per stroke: varint point count, u8 flags (bit0: pressure)
//   per point: zigzag varint dx, dy of x/y quantised to uint16 over [-0.05, 1.05],
//   varint dt in ms (full format only), u8 pressure 0–100 (pressure strokes only).
// Deltas run on across strokes, so a stroke that starts where the last one ended costs almost nothing.

const VERSION = 1, NO_TIME = 2, PRESSURE = 1;
const LO = -0.05, SPAN = 1.1, Q = 65535;

const quant = (v: number) => Math.round(((Math.min(1.05, Math.max(LO, v)) - LO) / SPAN) * Q);
const unquant = (q: number) => Math.round(((q / Q) * SPAN + LO) * 1e5) / 1e5;

class Writer {
  buf = new Uint8Array(1024);
  n = 0;
  byte(b: number) {
    if (this.n === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = b;
  }
  varint(v: number) {
    while (v > 127) { this.byte((v & 127) | 128); v = Math.floor(v / 128); }
    this.byte(v);
  }
  zigzag(v: number) { this.varint(v < 0 ? -2 * v - 1 : 2 * v); }
  done() { return this.buf.slice(0, this.n); }
}

class Reader {
  i = 0;
  constructor(readonly buf: Uint8Array) {}
  byte() {
    if (this.i >= this.buf.length) throw new Error('codec: truncated');
    return this.buf[this.i++];
  }
  varint() {
    let v = 0, mul = 1, b: number;
    do { b = this.byte(); v += (b & 127) * mul; mul *= 128; } while (b & 128);
    return v;
  }
  zigzag() { const v = this.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
}

function encode(strokes: { length: number; [i: number]: number[] }[], time: boolean, pressureOf: (s: number[][]) => boolean) {
  const w = new Writer();
  w.byte(VERSION);
  w.byte(time ? 0 : NO_TIME);
  w.varint(strokes.length);
  let px = 0, py = 0, pt = 0;
  for (const s of strokes as number[][][]) {
    const pressure = time && pressureOf(s);
    w.varint(s.length);
    w.byte(pressure ? PRESSURE : 0);
    for (const p of s) {
      const x = quant(p[0]), y = quant(p[1]);
      w.zigzag(x - px); w.zigzag(y - py);
      px = x; py = y;
      if (time) {
        const t = Math.max(pt, Math.round(p[2]));
        w.varint(t - pt);
        pt = t;
      }
      if (pressure) w.byte(Math.round(Math.min(1, Math.max(0, p[3] ?? 0.5)) * 100));
    }
  }
  return w.done();
}

function decode(bytes: Uint8Array) {
  const r = new Reader(bytes);
  if (r.byte() !== VERSION) throw new Error('codec: unknown version');
  const time = !(r.byte() & NO_TIME);
  const out: number[][][] = [];
  let px = 0, py = 0, pt = 0;
  for (let count = r.varint(); count > 0; count--) {
    const n = r.varint(), pressure = r.byte() & PRESSURE, s: number[][] = [];
    for (let i = 0; i < n; i++) {
      px += r.zigzag(); py += r.zigzag();
      const p = [unquant(px), unquant(py)];
      if (time) { pt += r.varint(); p.push(pt); }
      if (pressure) p.push(r.byte() / 100);
      s.push(p);
    }
    out.push(s);
  }
  return out;
}

export const encodeStrokes = (strokes: Stroke[]) => encode(strokes, true, s => s.some(p => p.length > 3));
export const decodeStrokes = (bytes: Uint8Array) => decode(bytes) as Stroke[];

/** Simplified at 1 px of a 1024 px tile (under a ~5 px line), no timing: what the map draws. */
export const DISPLAY_TOLERANCE = 1 / 1024;
export const encodeDisplay = (strokes: Stroke[] | DisplayStroke[]) =>
  encode(strokes.map(s => simplify(s as number[][], DISPLAY_TOLERANCE)), false, () => false);
export const decodeDisplay = (bytes: Uint8Array) => decode(bytes) as DisplayStroke[];

/** Ramer–Douglas–Peucker on x and y. Keeps the first and last point. */
export function simplify<T extends number[]>(pts: T[], tol: number): T[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let max = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d2: number;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > max) { max = d2; at = i; }
    }
    if (max > tol2) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(str: string): Uint8Array {
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export type { Point };
