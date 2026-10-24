import type { Map as MapLibre } from 'maplibre-gl';
import { bounds, centre, type Tile } from '../shared/tiles';

/** Biggest first. Continents only make sense on the first few levels. */
const CLASSES = ['continent', 'country', 'state', 'province', 'city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling'];

type Feature = { properties: Record<string, unknown> | null; geometry: { type: string; coordinates?: unknown } };

function point(f: Feature): [number, number] | null {
  const c = f.geometry.coordinates as number[] | number[][];
  if (f.geometry.type === 'Point') return c as [number, number];
  if (f.geometry.type === 'LineString') return (c as number[][])[(c.length / 2) | 0] as [number, number];
  return null;
}

const label = (p: Record<string, unknown>) => (p['name:en'] ?? p['name:latin'] ?? p.name_en ?? p.name) as string | undefined;

/**
 * A square's name, from the basemap's own place and water labels that fall inside it.
 * Nobody types a name, so there is nothing to moderate.
 */
export function pickName(places: Feature[], waters: Feature[], t: Tile): string {
  if (t.z === 0) return 'Earth';
  const b = bounds(t);
  const inside = (f: Feature) => {
    const p = point(f);
    return !!p && p[0] >= b.w && p[0] < b.e && p[1] <= b.n && p[1] > b.s && !!label(f.properties ?? {});
  };
  const order = (f: Feature) => {
    const i = CLASSES.indexOf(String(f.properties?.class));
    return i < 0 || (i === 0 && t.z > 3) ? 99 : i;
  };
  const best = places.filter(inside).filter(f => order(f) < 99)
    .sort((a, b) => order(a) - order(b) || Number(a.properties?.rank ?? 99) - Number(b.properties?.rank ?? 99))[0]
    ?? waters.filter(inside).sort((a, b) => Number(a.properties?.rank ?? 99) - Number(b.properties?.rank ?? 99))[0];
  if (best) return label(best.properties!)!;
  const { lat, lon } = centre(t);
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** Only what the map has loaded is searched, so call it with the square in view. */
export function nameFor(map: MapLibre, t: Tile): string {
  const src = Object.entries(map.getStyle()?.sources ?? {}).find(([, s]) => s.type === 'vector')?.[0];
  const q = (layer: string) => (src ? map.querySourceFeatures(src, { sourceLayer: layer }) : []) as Feature[];
  return pickName(q('place'), q('water_name'), t);
}
