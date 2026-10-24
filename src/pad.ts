import { Map as MapLibre } from 'maplibre-gl';
import { centre, parse, type Tile } from '../shared/tiles';
import type { DisplayStroke, DrawingIn, Lease, Point, PointerKind, Stroke } from '../shared/types';
import { LIMIT_MS, MAX_POINTS, MAX_STROKES, MIN_POINTS } from '../shared/validate';
import { ApiError, type Api } from './api';
import { meta, OFFLINE, sentence } from './label';
import type { Look } from './look';
import { BASEMAP, restyle } from './map';
import { nameFor, pickName } from './names';
import { paintFrame, paintStrokes } from './render';
import type { Store } from './store';

/** Margin around the square, as a fraction of its side: room for the neighbours' ink. */
const M = 0.08;
const DRAFT = 'hde:draft';
/** Points closer than this to the last one (fraction of the side, under 1 px) add nothing but bytes. */
const MIN_STEP = 0.0015;
/** Draw anyway if the tracing map is slow. */
const TRACE_WAIT_MS = 5000;

export type Draft = { lease: Lease; strokes: Stroke[]; duration: number; pointer: PointerKind; started: string };

export type PadDeps = {
  api: Api;
  store: Store;
  look: () => Look;
  /** A Keep landed. The pad has already closed. */
  saved: (id: number, t: Tile) => void;
  /** Squares that changed while the pad was open (someone else's drawing beat ours). */
  changed: (keys: string[]) => void;
  /** Back to map. */
  closed?: () => void;
};

type State = 'ready' | 'drawing' | 'done' | 'saving' | 'failed' | 'taken';

export function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as Draft | null;
    return d?.lease?.key && Array.isArray(d.strokes) && d.strokes.length ? d : null;
  } catch {
    return null;
  }
}
const clearDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch {} };

const kind = (p: string): PointerKind => (p === 'pen' || p === 'touch' ? p : 'mouse');
const clamp = (v: number) => Math.min(1.05, Math.max(-0.05, v));
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

function fit(cv: HTMLCanvasElement, px: number) {
  const r = devicePixelRatio || 1;
  cv.width = cv.height = Math.round(px * r);
  cv.style.width = cv.style.height = px + 'px';
  // CPU-backed: GPU-backed, the pad sometimes went on showing an older frame after it was cleared (spike lesson).
  cv.getContext('2d', { willReadFrequently: true })!.setTransform(r, 0, 0, r, 0, 0);
}

const HTML = `
<div class="pad-col">
  <div class="pad-label">
    <div class="pad-row"><span class="pad-name"></span><span class="pad-secs">60 s</span></div>
    <div class="pad-meta"></div>
  </div>
  <div class="pad-stage"><div class="pad-map"></div><canvas class="pad-under"></canvas><canvas class="pad-ink"></canvas></div>
  <div class="pad-ticks"></div>
  <div class="pad-controls">
    <button data-act="done">Done</button>
    <button data-act="keep" class="primary">Keep</button>
    <button data-act="retry" class="primary">Try again</button>
    <button data-act="another" class="primary">Draw another</button>
    <button data-act="redo">Redo</button>
    <button data-act="back">Back to map</button>
  </div>
  <p class="pad-hint"></p>
  <footer class="pad-foot">Map hint © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a></footer>
</div>`;

/** The drawing pad: one overlay, reused for every square. */
export function createPad(deps: PadDeps) {
  const { api, store } = deps;
  const root = document.createElement('div');
  root.className = 'pad';
  root.hidden = true;
  root.innerHTML = HTML;
  document.body.append(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const nameEl = $('.pad-name'), secsEl = $('.pad-secs'), metaEl = $('.pad-meta'), hintEl = $('.pad-hint');
  const mapEl = $<HTMLDivElement>('.pad-map'), under = $<HTMLCanvasElement>('.pad-under'), pad = $<HTMLCanvasElement>('.pad-ink');
  const ticks = $('.pad-ticks');
  const btn = (act: string) => $<HTMLButtonElement>(`[data-act="${act}"]`);
  for (let i = 0; i < 60; i++) {
    const tick = document.createElement('i');
    if (i % 5 === 4) tick.classList.add('major');
    if (i >= 50) tick.classList.add('late');
    ticks.append(tick);
  }

  let C = 0, S = 0, o = 0;
  let map: MapLibre | null = null;
  let lease: Lease | null = null, t: Tile = { z: 0, x: 0, y: 0 }, nextLease: Lease | null = null;
  let state: State = 'ready', traced = false, traceTimer = 0, named = false;
  let strokes: Stroke[] = [], active: { id: number; pts: Point[] } | null = null;
  let t0 = 0, started = '', duration = 0, pointer: PointerKind = 'mouse', timer = 0, frame = 0, gen = 0;
  let payload: DrawingIn | null = null;

  const points = () => strokes.reduce((n, s) => n + s.length, 0);
  const hint = (text: string) => { hintEl.textContent = text; };

  function layout() {
    // clientWidth, not innerWidth: on phones innerWidth follows the zoomed-out visual viewport at load (spike lesson).
    const { clientWidth: w, clientHeight: h } = document.documentElement;
    const c = Math.max(260, Math.floor(Math.min(w - 32, h - 250, 720)));
    if (c === C) return false;
    C = c; S = Math.floor(C / (1 + 2 * M)); if ((C - S) % 2) S--; o = (C - S) / 2;
    root.style.setProperty('--C', C + 'px'); root.style.setProperty('--S', S + 'px'); root.style.setProperty('--o', o + 'px');
    fit(under, C); fit(pad, S);
    Object.assign(pad.style, { left: o + 'px', top: o + 'px' });
    return true;
  }

  function ensureMap() {
    if (map) return map;
    map = new MapLibre({
      container: mapEl, style: BASEMAP,
      interactive: false, attributionControl: false, renderWorldCopies: true, fadeDuration: 0,
      minZoom: -2, center: [0, 0], zoom: 0,
      // The camera is placed by tile maths, so no clamping (otherwise the whole world gets zoomed to fill the stage).
      transformConstrain: (lngLat, zoom) => ({ center: lngLat, zoom }),
    });
    // The tracing hint is always fully there on the pad, whatever the browsing map's look does with it.
    map.on('style.load', () => { restyle(map!, { ...deps.look(), basemap: 1 }); map!.setProjection({ type: 'mercator' }); });
    map.on('error', e => console.warn('pad map:', e.error?.message ?? e));
    return map;
  }

  /** Puts the square exactly on the pad. Falls back to a map the size of the square if the camera got clamped. */
  function reframe() {
    const m = ensureMap(), c = centre(t), zoom = t.z + Math.log2(S / 512), mine = gen;
    const place = (full: boolean) => {
      Object.assign(mapEl.style, full
        ? { left: '0px', top: '0px', width: C + 'px', height: C + 'px' }
        : { left: o + 'px', top: o + 'px', width: S + 'px', height: S + 'px' });
      m.resize();
      m.jumpTo({ center: [c.lon, c.lat], zoom });
      const got = m.getCenter();
      return Math.abs(m.getZoom() - zoom) < 1e-6 && Math.abs(got.lat - c.lat) < 1e-6 && Math.abs(got.lng - c.lon) < 1e-6;
    };
    if (!place(true)) place(false);
    m.once('idle', () => {
      if (mine !== gen) return;
      // A smaller pad loads coarser tiles, which can miss the label found before; keep the first real name.
      const name = nameFor(m, t);
      if (!named) { nameEl.textContent = name; named = name !== pickName([], [], t); }
      traceReady();
    });
    drawUnder();
    redrawPad();
  }

  function traceReady() {
    clearTimeout(traceTimer);
    if (traced) return;
    traced = true;
    if (state === 'ready') hint('The 60 seconds start with your first line.');
  }

  /** Margin: the map washed out, plus the neighbouring squares' ink, so lines can carry on across edges. */
  function paintUnder(inks: [number, number, DisplayStroke[]][]) {
    const ctx = under.getContext('2d')!, look = deps.look();
    ctx.clearRect(0, 0, C, C);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.rect(o, o, S, S); ctx.clip('evenodd');
    ctx.globalAlpha = 0.55; ctx.fillStyle = look.paper; ctx.fillRect(0, 0, C, C);
    const width = Math.max(1, (S / 512) * look.inkWidth);
    for (const [dx, dy, s] of inks) paintStrokes(ctx, s, o + dx * S, o + dy * S, S, { width, color: look.ink, alpha: 0.6 });
    ctx.restore();
    ctx.save();
    ctx.translate(o, o);
    paintFrame(ctx, S, 0.5, Math.max(8, o * 0.6), { color: look.ink, alpha: 0.35 }, { color: look.ink, alpha: 0.9 });
    ctx.restore();
  }

  async function drawUnder() {
    const mine = gen, n = 2 ** t.z, around: [number, number, Tile][] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = t.y + dy, x = (((t.x + dx) % n) + n) % n;
      // At z1 the one neighbour column shows on both sides, as it does on the map.
      if ((dx || dy) && y >= 0 && y < n && !(x === t.x && y === t.y)) around.push([dx, dy, { z: t.z, x, y }]);
    }
    paintUnder([]);
    const inks = await Promise.all(around.map(async ([dx, dy, nb]) =>
      [dx, dy, await store.displayFor(nb).catch(() => null)] as [number, number, DisplayStroke[] | null]));
    if (mine === gen) paintUnder(inks.filter((r): r is [number, number, DisplayStroke[]] => !!r[2]));
  }

  function redrawPad(list: readonly (Stroke | DisplayStroke)[] = strokes) {
    cancelAnimationFrame(frame); frame = 0;
    const ctx = pad.getContext('2d')!, look = deps.look();
    ctx.clearRect(0, 0, S, S);
    paintStrokes(ctx, list, 0, 0, S, { width: Math.max(1, (S / 512) * look.inkWidth), color: look.ink });
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; redrawPad(); }); };

  function buttons() {
    const few = points() < MIN_POINTS;
    btn('done').hidden = state !== 'drawing';
    btn('keep').hidden = state !== 'done' || few;
    btn('retry').hidden = state !== 'failed';
    btn('another').hidden = state !== 'taken';
    btn('redo').hidden = !['drawing', 'done', 'failed'].includes(state);
    btn('back').hidden = !['ready', 'failed', 'taken'].includes(state);
  }
  function set(s: State, text: string) { state = s; buttons(); hint(text); }

  function showTime(elapsed: number) {
    const sec = Math.floor(elapsed / 1000), left = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
    [...ticks.children].forEach((tick, i) => tick.classList.toggle('on', i < sec));
    secsEl.textContent = `${left} s`;
    secsEl.classList.toggle('late', elapsed > 0 && left <= 10);
  }

  function saveDraft() {
    if (!lease || !strokes.length) return;
    const last = Math.max(0, ...strokes.flatMap(s => s.map(p => p[2])));
    const d: Draft = { lease, strokes, duration: duration || last, pointer, started };
    try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch {}
  }

  function reset() {
    clearTimeout(timer);
    strokes = []; active = null; duration = 0; payload = null;
    showTime(0);
    set('ready', traced ? 'The 60 seconds start with your first line.' : 'Loading the map…');
    redrawPad();
  }

  function start(e: PointerEvent) {
    t0 = e.timeStamp; started = new Date().toISOString(); pointer = kind(e.pointerType);
    set('drawing', 'No undo. Done stops early.');
    const run = () => {
      const elapsed = performance.now() - t0;
      showTime(elapsed);
      if (elapsed >= LIMIT_MS) finish(); else timer = window.setTimeout(run, 100);
    };
    run();
  }

  /** Stops the clock and builds the payload once: a retry sends exactly the same drawing. */
  function finish(restored = false) {
    if (state !== 'drawing' && !restored) return;
    clearTimeout(timer);
    if (!restored) duration = Math.min(LIMIT_MS, Math.round(performance.now() - t0));
    active = null;
    strokes = strokes.filter(s => s.length);
    payload = lease && { key: lease.key, token: lease.token, strokes, duration, pointer, started };
    showTime(duration);
    saveDraft();
    const few = points() < MIN_POINTS;
    set('done', few ? 'Too little to keep. Redo the square.'
      : restored ? 'Your drawing from before. Keep it, or redo the square.' : 'Keep it, or redo the square.');
  }

  function addPoint(e: PointerEvent) {
    const r = pad.getBoundingClientRect(), ms = Math.max(0, Math.round(e.timeStamp - t0));
    if (ms > LIMIT_MS || !active) return;
    const p: Point = [round4(clamp((e.clientX - r.left) / r.width)), round4(clamp((e.clientY - r.top) / r.height)), ms];
    if (e.pointerType === 'pen' && e.pressure > 0) p.push(Math.round(e.pressure * 100) / 100);
    const pts = active.pts, last = pts[pts.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return;
    pts.push(p);
    if (points() >= MAX_POINTS) finish();
  }

  pad.addEventListener('pointerdown', e => {
    if (!traced || active || e.button > 0 || (state !== 'ready' && state !== 'drawing')) return;
    if (strokes.length >= MAX_STROKES) return finish();
    e.preventDefault();
    if (state === 'ready') start(e);
    try { pad.setPointerCapture(e.pointerId); } catch {}
    active = { id: e.pointerId, pts: [] };
    strokes.push(active.pts);
    addPoint(e);
    schedule();
  });
  pad.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== active.id || state !== 'drawing') return;
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ev of list.length ? list : [e]) addPoint(ev);
    schedule();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    pad.addEventListener(type, e => {
      if (!active || e.pointerId !== active.id) return;
      active = null;
      saveDraft();
    });

  async function keep() {
    if (state !== 'done' && state !== 'failed') return;
    if (!payload) return;
    const sent = payload, tile = t;
    set('saving', 'Saving…');
    try {
      const { id } = await api.draw(sent);
      clearDraft();
      hide();
      deps.saved(id, tile);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return taken((e.body.lease as Lease | null) ?? null);
      if (e instanceof ApiError && e.status < 500) return set('failed', `Not saved: ${e.message}.`);
      set('failed', 'Not saved, the connection dropped. Your drawing is still here.');
    }
  }

  /** First save wins. Show the drawing that won, and offer the fresh square the server handed back. */
  async function taken(next: Lease | null) {
    const mine = gen;
    nextLease = next;
    clearDraft();
    set('taken', 'Someone else drew this square first.');
    try {
      const keys = await store.poll();
      if (keys.length) deps.changed(keys);
    } catch {}
    const theirs = await store.displayFor(t).catch(() => null);
    if (mine === gen && state === 'taken' && theirs) redrawPad(theirs);
  }

  async function another() {
    const l = nextLease;
    btn('another').disabled = true;
    try {
      open(l ?? (await api.lease()));
    } catch (e) {
      hint(e instanceof ApiError ? sentence(e.message) : OFFLINE);
    } finally {
      btn('another').disabled = false;
    }
  }

  function hide() {
    gen++;
    clearTimeout(timer); clearTimeout(traceTimer);
    root.hidden = true;
    active = null;
  }

  btn('done').onclick = () => finish();
  btn('keep').onclick = btn('retry').onclick = keep;
  btn('redo').onclick = () => { clearDraft(); reset(); };
  btn('another').onclick = another;
  btn('back').onclick = () => { clearDraft(); hide(); deps.closed?.(); };

  let resizing = 0;
  addEventListener('resize', () => {
    clearTimeout(resizing);
    resizing = window.setTimeout(() => { if (!root.hidden && layout()) reframe(); }, 150);
  });

  /** Opens the pad on a leased square, or on a drawing restored from before a reload. */
  function open(l: Lease, draft?: Draft) {
    gen++;
    lease = l; t = parse(l.key); nextLease = null;
    root.hidden = false;
    root.scrollTop = 0;
    layout();
    traced = !!draft;
    clearTimeout(traceTimer);
    traceTimer = window.setTimeout(traceReady, TRACE_WAIT_MS);
    nameEl.textContent = pickName([], [], t); named = false;
    metaEl.textContent = meta(t);
    reset();
    if (draft) {
      strokes = draft.strokes; duration = Math.min(LIMIT_MS, draft.duration); pointer = draft.pointer; started = draft.started;
      finish(true);
    }
    reframe();
  }

  return {
    open,
    close: hide,
    get isOpen() { return !root.hidden; },
    /** For e2e checks. */
    get state() { return state; },
  };
}

export type Pad = ReturnType<typeof createPad>;
