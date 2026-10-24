import { centre, type Tile } from '../shared/tiles';

const N = 1024, LEVEL = 10;
/** Mercator blows Antarctica up to a fifth of the map; it counts for less so the queue doesn't live there. */
const SOUTH = -60, SOUTH_WEIGHT = 0.3;

/** Land fraction of a square, from a 1024² Web Mercator bitmask (row-major, MSB first). */
export function createLand(bits: Uint8Array): (t: Tile) => number {
  // Summed-area table: any square at z <= 10 is a 4-lookup sum.
  const W = N + 1, sat = new Uint32Array(W * W);
  for (let y = 0; y < N; y++) {
    let row = 0;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      row += (bits[i >> 3] >> (7 - (i & 7))) & 1;
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  return (t: Tile) => {
    let f: number;
    if (t.z <= LEVEL) {
      const s = N >> t.z, x0 = t.x * s, y0 = t.y * s, x1 = x0 + s, y1 = y0 + s;
      f = (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / (s * s);
    } else {
      const d = t.z - LEVEL, i = (t.y >> d) * N + (t.x >> d);
      f = (bits[i >> 3] >> (7 - (i & 7))) & 1;
    }
    return centre(t).lat < SOUTH ? f * SOUTH_WEIGHT : f;
  };
}
