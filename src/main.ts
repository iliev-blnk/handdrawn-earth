import 'maplibre-gl/dist/maplibre-gl.css';
import './base.css';
import * as maplibregl from 'maplibre-gl';
import { createApi } from './api';
import { registerInk } from './ink';
import { applyLook, DEFAULT_LOOK } from './look';
import { createMap, flyToSquare, refresh, WORLD_ZOOM } from './map';
import { createPad, loadDraft } from './pad';
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
store.watch(keys => refresh(map, keys));

const pad = createPad({
  api, store, look: () => look,
  saved: (id, t) => { refresh(map, store.addSaved(id, t)); flyToSquare(map, t); },
  changed: keys => refresh(map, keys),
});
const draft = loadDraft();
if (draft) pad.open(draft.lease, draft);

// For e2e checks.
Object.assign(window, { __earth: { map, store, pad, api } });
