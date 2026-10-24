import 'maplibre-gl/dist/maplibre-gl.css';
import './base.css';
import * as maplibregl from 'maplibre-gl';
import { createApi } from './api';
import { registerInk } from './ink';
import { applyLook, DEFAULT_LOOK } from './look';
import { MAX_Z } from '../shared/tiles';
import { createMap, flyToSquare, refresh, tileAtPoint, WORLD_ZOOM } from './map';
import { createPad, loadDraft } from './pad';
import { createSheet } from './sheet';
import { Store } from './store';

const api = createApi();
const store = new Store(api, Date.now);
const look = DEFAULT_LOOK;
applyLook(look);
registerInk(maplibregl, store, () => look);

const [hello] = await Promise.all([api.hello().catch(() => null), store.load().catch(e => console.warn('index:', e))]);
const map = createMap(document.getElementById('map')!, look, {
  center: [hello?.lon ?? 10, hello?.lat ?? 30], zoom: WORLD_ZOOM,
});
const changed = (keys: string[]) => { refresh(map, keys); sheet.changed(keys); };
store.watch(changed);

const pad = createPad({
  api, store, look: () => look, changed,
  // Your square, on the map now, with its replay.
  saved: (id, t) => { changed(store.addSaved(id, t)); flyToSquare(map, t); sheet.show(t); },
});
const sheet = createSheet(map, { api, store, look: () => look, changed, draw: lease => pad.open(lease) });
map.on('click', e => sheet.show(tileAtPoint(map, e.point, Math.max(0, Math.min(MAX_Z, Math.round(map.getZoom()))))));
const draft = loadDraft();
if (draft) pad.open(draft.lease, draft);

// For e2e checks.
Object.assign(window, { __earth: { map, store, pad, sheet, api } });
