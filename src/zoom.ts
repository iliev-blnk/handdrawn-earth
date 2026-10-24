import { MAX_Z } from '../shared/tiles';

/** The whole globe on a phone. */
export const WORLD_ZOOM = 1.4;
/** Ink tiles exist to z16; past that the map just magnifies them. */
export const MAX_ZOOM = 18;

/** Steps from map zoom to square level: 0 for 512 px squares, 1 for 256 px. */
const deeper = (square: number) => Math.log2(512 / square);

/** The level of squares MapLibre shows at a map zoom: raster sources round, so that's the rounded zoom, offset by size. */
export function displayLevel(zoom: number, square: number) {
  return Math.max(0, Math.min(MAX_Z, Math.round(zoom + deeper(square))));
}

/**
 * The map zoom that shows square level z, with a square about two thirds of the shorter side across.
 * Kept within the band where the map shows z itself: past it a phone would show the parent's drawing instead.
 * The first few levels are the whole globe anyway.
 */
export function squareZoom(z: number, side: number, square: number) {
  const mid = z - deeper(square), want = z + Math.log2((side * 0.66) / 512);
  return Math.max(WORLD_ZOOM, Math.min(MAX_ZOOM, mid + 0.45, Math.max(mid - 0.45, want)));
}
