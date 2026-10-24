// Web Mercator slippy tiles: every square in the world is one z/x/y.
export type Tile = { z: number; x: number; y: number };

export const MAX_Z = 16;

export const key = ({ z, x, y }: Tile) => `${z}/${x}/${y}`;

export function parse(k: string): Tile {
  const [z, x, y] = k.split('/').map(Number);
  return { z, x, y };
}

export function isTile(t: Tile, maxZ = MAX_Z): boolean {
  const { z, x, y } = t;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > maxZ) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

export const parent = ({ z, x, y }: Tile): Tile | null => (z === 0 ? null : { z: z - 1, x: x >> 1, y: y >> 1 });

/** NW, NE, SW, SE. */
export const children = ({ z, x, y }: Tile): Tile[] => [
  { z: z + 1, x: 2 * x, y: 2 * y },
  { z: z + 1, x: 2 * x + 1, y: 2 * y },
  { z: z + 1, x: 2 * x, y: 2 * y + 1 },
  { z: z + 1, x: 2 * x + 1, y: 2 * y + 1 },
];

export function ancestors(t: Tile): Tile[] {
  const out: Tile[] = [];
  for (let p = parent(t); p; p = parent(p)) out.push(p);
  return out;
}

/** Up to eight squares around t. x wraps across the antimeridian; there is nothing past the poles. */
export function neighbours(t: Tile): Tile[] {
  const n = 2 ** t.z, out: Tile[] = [], seen = new Set<string>([key(t)]);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const y = t.y + dy, x = (((t.x + dx) % n) + n) % n;
    if (y < 0 || y >= n) continue;
    const k = `${t.z}/${x}/${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ z: t.z, x, y });
  }
  return out;
}

const latOf = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

export function bounds({ z, x, y }: Tile) {
  const n = 2 ** z;
  return { w: (x / n) * 360 - 180, e: ((x + 1) / n) * 360 - 180, n: latOf(y, n), s: latOf(y + 1, n) };
}

export function centre({ z, x, y }: Tile) {
  const n = 2 ** z;
  return { lon: ((x + 0.5) / n) * 360 - 180, lat: latOf(y + 0.5, n) };
}

export function kmAcross(t: Tile): number {
  return (40075.017 * Math.cos((centre(t).lat * Math.PI) / 180)) / 2 ** t.z;
}

export function tileAt(lat: number, lon: number, z: number): Tile {
  const n = 2 ** z, r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  return {
    z,
    x: clamp(((lon + 180) / 360) * n),
    y: clamp(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}
