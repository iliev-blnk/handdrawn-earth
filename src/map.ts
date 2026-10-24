import { AttributionControl, Map as MapLibre, setWorkerUrl, type PointLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { centre, parent, tileAt, type Tile } from '../shared/tiles';
import { inkLog } from './ink';
import type { Look } from './look';
import { MAX_ZOOM, squareZoom, WORLD_ZOOM } from './zoom';

// MapLibre finds its worker next to its own module, which Vite's dependency bundling moves. Point at it directly.
setWorkerUrl(workerUrl);

export const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
export const INK = 'ink';

/** Positron, stripped to a faint tracing hint: water, roads, rivers, borders, building outlines. */
export function restyle(map: MapLibre, look: Look) {
  const a = look.basemap;
  for (const layer of map.getStyle().layers) {
    const { id, type } = layer, src = 'source-layer' in layer ? layer['source-layer'] ?? '' : '';
    const set = (k: string, v: unknown) => map.setPaintProperty(id, k as never, v as never);
    if (id === INK) continue;
    if (type === 'background') set('background-color', look.paper);
    else if (type === 'fill' && src === 'water') { set('fill-color', look.water); set('fill-opacity', a); }
    else if (type === 'fill' && src === 'building') { set('fill-color', 'rgba(0,0,0,0)'); set('fill-outline-color', look.hint); set('fill-opacity', a); }
    else if (type === 'line' && src === 'waterway') { set('line-color', look.waterLine); set('line-width', 1); set('line-opacity', a); }
    else if (type === 'line' && src === 'transportation' && !id.includes('casing')) { set('line-color', look.hint); set('line-width', 1.1); set('line-opacity', a); }
    else if (type === 'line' && src === 'boundary') { set('line-color', look.hint); set('line-opacity', a); }
    else map.setLayoutProperty(id, 'visibility', 'none');
  }
}

export function setProjection(map: MapLibre, look: Look) {
  map.setProjection(look.globe
    ? { type: ['interpolate', ['linear'], ['zoom'], 4, 'vertical-perspective', 6, 'mercator'] }
    : { type: 'mercator' });
}

export type View = { center: [number, number]; zoom: number };

/** The browsing map: the faint basemap with every drawn square painted over it. */
export function createMap(el: HTMLElement, look: Look, view: View = { center: [0, 20], zoom: WORLD_ZOOM }): MapLibre {
  el.style.background = look.space;
  const map = new MapLibre({
    container: el, style: BASEMAP, ...view,
    maxZoom: MAX_ZOOM, renderWorldCopies: true, fadeDuration: 0,
    attributionControl: false, dragRotate: false, pitchWithRotate: false,
  });
  // Top right: the bottom of the screen belongs to the sheet and the Draw button.
  map.addControl(new AttributionControl({ compact: true }), 'top-right');
  // MapLibre opens it until the first drag; on a phone it covers the title until then.
  map.once('idle', () => el.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.on('style.load', () => {
    restyle(map, look);
    setProjection(map, look);
    map.addSource(INK, { type: 'raster', tiles: ['ink://{z}/{x}/{y}'], tileSize: look.square, minzoom: 0, maxzoom: 16 });
    map.addLayer({ id: INK, type: 'raster', source: INK, paint: { 'raster-fade-duration': 250, 'raster-resampling': 'linear' } });
  });
  map.on('error', e => console.warn('map:', e.error?.message ?? e));
  return map;
}

/** The square of zoom level z under a screen point. */
export function tileAtPoint(map: MapLibre, point: PointLike, z: number): Tile {
  const ll = map.unproject(point).wrap();
  return tileAt(ll.lat, ll.lng, z);
}

/**
 * Repaint what changed: each changed square, and every loaded square under it, because those show a crop
 * of their nearest drawn ancestor. Tiles that failed to paint get another go.
 */
export function refresh(map: MapLibre, keys: Iterable<string>) {
  const changed = new Set(keys), redo: Tile[] = [];
  for (const [k, t] of inkLog.asked) {
    let hit = inkLog.failed.has(k);
    for (let a: Tile | null = t; a && !hit; a = parent(a)) hit = changed.has(`${a.z}/${a.x}/${a.y}`);
    if (hit) redo.push(t);
  }
  if (redo.length && map.getSource(INK)) map.refreshTiles(INK, redo);
}

/** Centre a square at a zoom where the map shows that square's own drawing. */
export function flyToSquare(map: MapLibre, t: Tile, square: number, duration = 1600) {
  const { lat, lon } = centre(t), side = Math.min(map.getContainer().clientWidth, map.getContainer().clientHeight);
  map.flyTo({ center: [lon, lat], zoom: squareZoom(t.z, side, square), duration, essential: true });
}
