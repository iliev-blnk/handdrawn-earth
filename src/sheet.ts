import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { bounds, key, type Tile } from '../shared/tiles';
import type { Lease, PointerKind } from '../shared/types';
import { ApiError, type Api } from './api';
import { meta, OFFLINE, sentence } from './label';
import type { Look } from './look';
import { flyToSquare } from './map';
import { nameFor } from './names';
import { paintFrame, paintStrokes } from './render';
import type { Drawing, Store } from './store';

const PICK = 'pick';
const REPLAY_SPEED = 2;

export type SheetDeps = {
  api: Api;
  store: Store;
  look: () => Look;
  /** Open the pad on a leased square. */
  draw: (lease: Lease) => void;
  /** Squares that changed (a flag hid one, or a poll found news). */
  changed: (keys: string[]) => void;
  /** The sheet now shows t, or nothing. */
  shown?: (t: Tile | null) => void;
};

const POINTERS: Record<PointerKind, string> = { touch: 'phone', mouse: 'mouse', pen: 'pen' };

function when(createdSec: number, now = Date.now()) {
  const s = now / 1000 - createdSec;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(createdSec * 1000);
}

const HTML = `
<div class="sheet-head">
  <span class="sheet-name"></span>
  <button class="sheet-close text" aria-label="Close">Close</button>
</div>
<div class="sheet-meta"></div>
<div class="sheet-drawn">
  <div class="sheet-meta sheet-made"></div>
  <canvas class="sheet-replay"></canvas>
  <div class="sheet-actions">
    <button data-act="replay">Replay</button>
    <button data-act="flag" class="text">Flag</button>
  </div>
</div>
<div class="sheet-open">
  <p class="sheet-say"></p>
  <div class="sheet-actions"><button data-act="go" class="primary"></button></div>
</div>
<p class="sheet-note"></p>`;

/** The card that opens when a square is tapped: its drawing and replay, or what it takes to draw it. */
export function createSheet(map: MapLibre, deps: SheetDeps) {
  const { api, store } = deps;
  const root = document.createElement('div');
  root.className = 'sheet';
  root.hidden = true;
  root.innerHTML = HTML;
  document.body.append(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const nameEl = $('.sheet-name'), metaEl = $('.sheet-meta'), madeEl = $('.sheet-made'), noteEl = $('.sheet-note');
  const drawnEl = $('.sheet-drawn'), openEl = $('.sheet-open'), sayEl = $('.sheet-say');
  const cv = $<HTMLCanvasElement>('.sheet-replay');
  const btn = (act: string) => $<HTMLButtonElement>(`[data-act="${act}"]`);

  let cur: Tile | null = null, gen = 0, frame = 0, drawing: Drawing | null = null, flagArmed = false;
  let go: () => void = () => {};
  const note = (text: string) => { noteEl.textContent = text; };

  function highlight(t: Tile | null) {
    const b = t && bounds(t);
    const data = {
      type: 'FeatureCollection' as const,
      features: b ? [{
        type: 'Feature' as const, properties: {},
        geometry: { type: 'LineString' as const, coordinates: [[b.w, b.n], [b.e, b.n], [b.e, b.s], [b.w, b.s], [b.w, b.n]] },
      }] : [],
    };
    const src = map.getSource(PICK) as GeoJSONSource | undefined;
    if (src) return src.setData(data);
    if (!map.isStyleLoaded()) return;
    map.addSource(PICK, { type: 'geojson', data });
    map.addLayer({ id: PICK, type: 'line', source: PICK, paint: { 'line-color': deps.look().ink, 'line-width': 1.5 } });
  }

  function size() {
    // On a phone the sheet keeps most of the map in view.
    const side = Math.floor(Math.min(320, root.clientWidth - 26, document.documentElement.clientHeight * 0.28));
    const r = devicePixelRatio || 1;
    cv.width = cv.height = Math.round(side * r);
    cv.style.width = cv.style.height = side + 'px';
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx, side };
  }

  function paintAt(upTo: number | undefined) {
    if (!drawing) return;
    const { ctx, side } = size(), look = deps.look();
    ctx.fillStyle = look.paper;
    ctx.fillRect(0, 0, side, side);
    paintStrokes(ctx, drawing.strokes, 0, 0, side, { width: Math.max(1, (side / 512) * look.inkWidth), color: look.ink, upTo });
    paintFrame(ctx, side, 0.5, 0, { color: look.ink, alpha: 0.35 });
  }

  function replay() {
    if (!drawing) return;
    cancelAnimationFrame(frame);
    const begin = performance.now(), total = drawing.duration || 60_000;
    const step = (now: number) => {
      const t = (now - begin) * REPLAY_SPEED;
      paintAt(Math.min(t, total));
      if (t < total) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function label(t: Tile) {
    nameEl.textContent = nameFor(map, t);
    metaEl.textContent = meta(t);
  }

  async function showDrawn(t: Tile, mine: number) {
    drawnEl.hidden = false;
    madeEl.textContent = 'Loading the drawing…';
    flagArmed = false;
    btn('flag').textContent = 'Flag';
    btn('flag').disabled = false;
    try {
      const d = await store.drawingFor(t)!;
      if (mine !== gen) return;
      drawing = d;
      madeEl.textContent = `${Math.round(d.duration / 1000)} s · ${POINTERS[d.pointer] ?? d.pointer} · ${when(d.created)}`;
      replay();
    } catch {
      if (mine === gen) madeEl.textContent = 'The drawing did not load. Tap the square again.';
    }
  }

  function showOpen(say: string, action: string, run: () => void) {
    openEl.hidden = false;
    sayEl.textContent = say;
    btn('go').textContent = action;
    btn('go').disabled = false;
    go = run;
  }

  /** The square above t that can be drawn now: one level below its nearest drawn ancestor. */
  function frontierAbove(t: Tile): Tile {
    const z = (store.nearestDrawn(t)?.tile.z ?? -1) + 1, k = t.z - z;
    return { z, x: t.x >> k, y: t.y >> k };
  }

  function show(t: Tile) {
    const mine = ++gen;
    cur = t; drawing = null;
    cancelAnimationFrame(frame);
    root.hidden = false;
    drawnEl.hidden = openEl.hidden = true;
    note('');
    label(t);
    highlight(t);
    deps.shown?.(t);
    // The name comes from what the map has loaded; after a fly it knows more.
    map.once('idle', () => { if (mine === gen && cur) nameEl.textContent = nameFor(map, cur); });

    if (store.isDrawn(t)) return void showDrawn(t, mine);
    if (store.isFrontier(t)) {
      return showOpen('Nobody has drawn this square yet.', 'Draw it', async () => {
        btn('go').disabled = true;
        try {
          const lease = await api.lease(key(t));
          if (mine !== gen) return;
          hide();
          deps.draw(lease);
        } catch (e) {
          if (mine !== gen) return;
          btn('go').disabled = false;
          if (e instanceof ApiError && e.status === 409) {
            // Drawn since our last look: catch up and show it.
            const keys = await store.poll().catch(() => []);
            deps.changed(keys);
            return show(t);
          }
          note(e instanceof ApiError ? sentence(e.message) : OFFLINE);
        }
      });
    }
    const up = frontierAbove(t);
    showOpen('Draw the square above it first.', 'Show me', () => {
      flyToSquare(map, up);
      show(up);
    });
  }

  async function flag() {
    if (!drawing || !cur) return;
    if (!flagArmed) {
      flagArmed = true;
      btn('flag').textContent = 'Tap again to flag';
      return;
    }
    const mine = gen, id = drawing.id;
    btn('flag').disabled = true;
    try {
      const { hidden } = await api.flag(id);
      if (mine !== gen) return;
      if (hidden) {
        const keys = await store.poll().catch(() => [] as string[]);
        deps.changed(keys);
        hide();
        return;
      }
      btn('flag').textContent = 'Flagged';
    } catch (e) {
      if (mine !== gen) return;
      btn('flag').disabled = false;
      note(e instanceof ApiError ? sentence(e.message) : OFFLINE);
    }
  }

  function hide() {
    gen++;
    cur = null; drawing = null;
    cancelAnimationFrame(frame);
    root.hidden = true;
    highlight(null);
    deps.shown?.(null);
  }

  btn('replay').onclick = replay;
  btn('flag').onclick = flag;
  btn('go').onclick = () => go();
  $('.sheet-close').onclick = hide;
  addEventListener('keydown', e => { if (e.key === 'Escape' && cur) hide(); });

  return {
    show,
    hide,
    get current() { return cur; },
    /** Re-show the square if it changed under us. */
    changed(keys: string[]) {
      if (cur && keys.includes(key(cur))) show(cur);
    },
  };
}

export type Sheet = ReturnType<typeof createSheet>;
