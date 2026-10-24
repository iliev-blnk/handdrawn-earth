import type { DisplayStroke, Stroke } from '../shared/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type PaintOpts = { width: number; color: string; alpha?: number; upTo?: number };

/**
 * Curve pieces wider than this (canvas units) are split before they reach the canvas: canvas paths are
 * float32, and a z0 line seen from z16 sits tens of millions of px away, about 4 px of rounding.
 */
const BIG = 4096;

/**
 * Strokes in square-relative coordinates, drawn at (ox, oy) with side `size`. Smoothed through
 * midpoints like the spike. Only the pieces that touch the canvas are drawn, so a 65536× crop
 * of an ancestor costs a handful of curves, not the whole drawing.
 */
export function paintStrokes(ctx: Ctx, strokes: readonly (Stroke | DisplayStroke)[], ox: number, oy: number, size: number, o: PaintOpts) {
  const k = ctx.getTransform().a || 1, pad = o.width * 2;
  const x0 = -pad, y0 = -pad, x1 = ctx.canvas.width / k + pad, y1 = ctx.canvas.height / k + pad;
  const dots: [number, number][] = [];
  let penX = NaN, penY = NaN;

  const piece = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, depth: number): void => {
    const minX = Math.min(ax, cx, bx), maxX = Math.max(ax, cx, bx);
    const minY = Math.min(ay, cy, by), maxY = Math.max(ay, cy, by);
    if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) return;
    if ((maxX - minX > BIG || maxY - minY > BIG) && depth < 40) {
      // de Casteljau halves, in double precision
      const acx = (ax + cx) / 2, acy = (ay + cy) / 2, cbx = (cx + bx) / 2, cby = (cy + by) / 2;
      const mx = (acx + cbx) / 2, my = (acy + cby) / 2;
      piece(ax, ay, acx, acy, mx, my, depth + 1);
      piece(mx, my, cbx, cby, bx, by, depth + 1);
      return;
    }
    if (ax !== penX || ay !== penY) ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    penX = bx; penY = by;
  };

  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = o.color;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = o.width;
  ctx.beginPath();
  for (const s of strokes as readonly (readonly number[])[][]) {
    const pts = o.upTo === undefined ? s : s.filter(p => p[2] <= o.upTo!);
    if (!pts.length) continue;
    const X = (i: number) => ox + pts[i][0] * size, Y = (i: number) => oy + pts[i][1] * size;
    if (pts.length === 1) {
      const x = X(0), y = Y(0);
      if (x > x0 && x < x1 && y > y0 && y < y1) dots.push([x, y]);
      continue;
    }
    let sx = X(0), sy = Y(0);
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = X(i), cy = Y(i), mx = (cx + X(i + 1)) / 2, my = (cy + Y(i + 1)) / 2;
      piece(sx, sy, cx, cy, mx, my, 0);
      sx = mx; sy = my;
    }
    const ex = X(pts.length - 1), ey = Y(pts.length - 1);
    piece(sx, sy, (sx + ex) / 2, (sy + ey) / 2, ex, ey, 0);
  }
  ctx.stroke();
  if (dots.length) {
    ctx.beginPath();
    for (const [x, y] of dots) { ctx.moveTo(x + o.width / 2, y); ctx.arc(x, y, o.width / 2, 0, 2 * Math.PI); }
    ctx.fill();
  }
  ctx.restore();
}

/** Hairline square edge plus registration crosshairs at the corners. Neighbours draw the other halves. */
export function paintFrame(ctx: Ctx, size: number, line: number, arm: number, edge: { color: string; alpha: number }, marks?: { color: string; alpha: number }) {
  ctx.save();
  ctx.lineWidth = line * 2; // centred on the edge, so half of it falls on this square
  ctx.strokeStyle = edge.color;
  ctx.globalAlpha = edge.alpha;
  ctx.strokeRect(0, 0, size, size);
  if (marks) {
    ctx.strokeStyle = marks.color;
    ctx.globalAlpha = marks.alpha;
    ctx.beginPath();
    for (const [cx, cy] of [[0, 0], [size, 0], [0, size], [size, size]]) {
      ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
    }
    ctx.stroke();
  }
  ctx.restore();
}
