import 'maplibre-gl/dist/maplibre-gl.css';
import './base.css';
import * as maplibregl from 'maplibre-gl';
import { createApi } from './api';
import { registerInk } from './ink';
import { applyLook, DEFAULT_LOOK } from './look';
import { createMap, refresh } from './map';
import { Store } from './store';

const api = createApi();
const store = new Store(api, Date.now);
const look = DEFAULT_LOOK;
applyLook(look);
registerInk(maplibregl, store, () => look);

const [hello] = await Promise.all([api.hello().catch(() => null), store.load()]);
const map = createMap(document.getElementById('map')!, look, {
  center: [hello?.lon ?? 10, hello?.lat ?? 30], zoom: 1.4,
});
store.watch(keys => refresh(map, keys));
// For e2e checks.
Object.assign(window, { __earth: { map, store } });
