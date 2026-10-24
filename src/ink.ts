import type { Tile } from '../shared/tiles';
import type { Look } from './look';
import { paintFrame, paintStrokes } from './render';
import type { Store } from './store';

/** Ink tiles are drawn at 1024 px and shown at 512, so lines stay sharp on 2× screens. */
export const TILE_PX = 1024;
export const ANCESTOR_ALPHA = 0.35;

export type Plan =
  | { kind: 'own'; tile: Tile }
  /** Ancestor strokes go at (ox, oy)·size with side scale·size. */
  | { kind: 'ancestor'; tile: Tile; ox: number; oy: number; scale: number }
  | { kind: 'none' };

/** What a map tile shows: its own drawing, or a crop of the nearest drawn square above it. */
export function planTile(t: Tile, store: Pick<Store, 'nearestDrawn'>): Plan {
  const n = store.nearestDrawn(t);
  if (!n) return { kind: 'none' };
  if (n.tile.z === t.z) return { kind: 'own', tile: t };
  const scale = 2 ** (t.z - n.tile.z);
  return { kind: 'ancestor', tile: n.tile, ox: -(t.x - n.tile.x * scale), oy: -(t.y - n.tile.y * scale), scale };
}

export async function renderTile(t: Tile, store: Store, look: Look, size = TILE_PX): Promise<OffscreenCanvas> {
  const plan = planTile(t, store);
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const px = size / 512, width = look.inkWidth * px;
  if (plan.kind === 'own') {
    const strokes = await store.displayFor(t);
    ctx.fillStyle = look.paper;
    ctx.fillRect(0, 0, size, size);
    if (strokes) paintStrokes(ctx, strokes, 0, 0, size, { width, color: look.ink });
    paintFrame(ctx, size, px, 14 * px, { color: look.ink, alpha: 0.35 },
      { color: store.recent(t) ? look.accent : look.ink, alpha: 0.9 });
  } else if (plan.kind === 'ancestor') {
    const strokes = await store.displayFor(plan.tile);
    if (strokes) paintStrokes(ctx, strokes, plan.ox * size, plan.oy * size, plan.scale * size, { width, color: look.ink, alpha: ANCESTOR_ALPHA });
    if (look.grid > 0) paintFrame(ctx, size, px / 2, 0, { color: look.hint, alpha: look.grid });
  }
  return cv;
}

/** Squares the map has asked for (newest last), and the ones that failed to paint, so a refresh knows what to redo. */
export const inkLog = { asked: new Map<string, Tile>(), failed: new Set<string>() };
const ASKED_MAX = 2048;

/** `ink://z/x/y`: every ink tile is painted here from strokes, never fetched as an image. */
export function registerInk(maplibre: { addProtocol: typeof import('maplibre-gl').addProtocol }, store: Store, look: () => Look) {
  maplibre.addProtocol('ink', async params => {
    const m = /^ink:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad ink url ${params.url}`);
    const t = { z: +m[1], x: +m[2], y: +m[3] }, k = `${t.z}/${t.x}/${t.y}`;
    inkLog.asked.delete(k);
    inkLog.asked.set(k, t);
    if (inkLog.asked.size > ASKED_MAX) inkLog.asked.delete(inkLog.asked.keys().next().value!);
    try {
      const cv = await renderTile(t, store, look());
      inkLog.failed.delete(k);
      return { data: cv.transferToImageBitmap() };
    } catch (e) {
      inkLog.failed.add(k);
      throw e;
    }
  });
}
