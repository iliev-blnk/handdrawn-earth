import { decodeDisplay, decodeStrokes, unb64 } from '../shared/codec';
import { ancestors, key, MAX_Z, parent, type Tile } from '../shared/tiles';
import type { DisplayStroke, IndexRow, PointerKind, Stroke } from '../shared/types';
import type { Api, IndexOut } from './api';

const DAY = 86_400;
const POLL_MS = 30_000;

export type Drawing = { id: number; key: string; strokes: Stroke[]; duration: number; pointer: PointerKind; created: number };

const blockOf = (z: number, x: number, y: number) => `${z}/${x >> 3}/${y >> 3}`;

/** What the client knows about the world: the index of drawn squares, plus caches of their strokes. */
export class Store {
  count = 0;
  private byKey = new Map<string, IndexRow>();
  private byId = new Map<number, IndexRow>();
  private blocks = new Map<string, Map<string, number>>();
  private maxId = 0;
  private packs = new Map<string, { v: number; p: Promise<Map<string, DisplayStroke[]>> }>();
  private full = new Map<number, Promise<Drawing>>();

  constructor(private api: Api, private now = () => Date.now()) {}

  async load() {
    this.apply(await this.api.index(0));
  }

  /** Fetch what changed since the last look. Returns the keys of squares that changed. */
  async poll(): Promise<string[]> {
    return this.apply(await this.api.index(this.maxId));
  }

  /** Poll every 30 s while the tab is visible. */
  watch(onChange: (keys: string[]) => void) {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      this.poll().then(keys => keys.length && onChange(keys), () => {});
    };
    document.addEventListener('visibilitychange', tick);
    return setInterval(tick, POLL_MS);
  }

  /** A square this visitor just saved: on the map now, not in 30 s. */
  addSaved(id: number, t: Tile): string[] {
    const fresh = !this.byKey.has(key(t));
    const changed = this.add([id, t.z, t.x, t.y, Math.floor(this.now() / 1000)]);
    if (fresh) this.count++;
    return changed;
  }

  isDrawn(t: Tile) { return this.byKey.has(key(t)); }
  idOf(t: Tile) { return this.byKey.get(key(t))?.[0] ?? null; }
  keyOf(id: number) {
    const r = this.byId.get(id);
    return r ? `${r[1]}/${r[2]}/${r[3]}` : null;
  }

  /** The square's own drawing if it has one, otherwise its nearest drawn ancestor's. */
  nearestDrawn(t: Tile): { tile: Tile; id: number } | null {
    for (const a of [t, ...ancestors(t)]) {
      const r = this.byKey.get(key(a));
      if (r) return { tile: a, id: r[0] };
    }
    return null;
  }

  /** Drawable now: undrawn, parent drawn (or the whole world), not past z16. */
  isFrontier(t: Tile) {
    if (t.z > MAX_Z || this.isDrawn(t)) return false;
    const p = parent(t);
    return !p || this.isDrawn(p);
  }

  recent(t: Tile) {
    const r = this.byKey.get(key(t));
    return !!r && this.now() / 1000 - r[4] < DAY;
  }

  /** Display strokes for every drawn square in t's 8×8 block, keyed by square. One request per block version. */
  packFor(t: Tile): Promise<Map<string, DisplayStroke[]>> {
    const b = blockOf(t.z, t.x, t.y), members = this.blocks.get(b);
    let v = 0;
    if (members) for (const id of members.values()) v = Math.max(v, id);
    if (!v) return Promise.resolve(new Map());
    const cached = this.packs.get(b);
    if (cached?.v === v) return cached.p;
    const [, px, py] = b.split('/').map(Number);
    const p = this.api.pack(t.z, px, py, v).then(out => {
      const m = new Map<string, DisplayStroke[]>();
      for (const r of out.rows) {
        const k = `${t.z}/${r.x}/${r.y}`;
        // Rows the index doesn't know (hidden, or newer than our last poll) are skipped.
        if (this.byKey.get(k)?.[0] === r.id) m.set(k, decodeDisplay(unb64(r.d)));
      }
      return m;
    });
    p.catch(() => this.packs.get(b)?.p === p && this.packs.delete(b));
    this.packs.set(b, { v, p });
    return p;
  }

  async displayFor(t: Tile): Promise<DisplayStroke[] | null> {
    if (!this.isDrawn(t)) return null;
    return (await this.packFor(t)).get(key(t)) ?? null;
  }

  /** The full drawing with timing, for the replay. */
  drawingFor(t: Tile): Promise<Drawing> | null {
    const id = this.idOf(t);
    if (id === null) return null;
    let p = this.full.get(id);
    if (!p) {
      p = this.api.drawing(id).then(d => ({ ...d, strokes: decodeStrokes(unb64(d.strokes)) }));
      p.catch(() => this.full.delete(id));
      if (this.full.size > 50) this.full.delete(this.full.keys().next().value!);
      this.full.set(id, p);
    }
    return p;
  }

  private apply(out: IndexOut): string[] {
    const changed: string[] = [];
    for (const row of out.rows) changed.push(...this.add(row));
    for (const id of out.hidden) {
      const r = this.byId.get(id);
      if (!r) continue;
      const k = `${r[1]}/${r[2]}/${r[3]}`;
      this.byId.delete(id);
      if (this.byKey.get(k)?.[0] === id) {
        this.byKey.delete(k);
        this.blocks.get(blockOf(r[1], r[2], r[3]))?.delete(k);
        changed.push(k);
      }
    }
    this.count = out.count;
    return changed;
  }

  private add(row: IndexRow): string[] {
    const [id, z, x, y] = row, k = `${z}/${x}/${y}`;
    if (this.byKey.get(k)?.[0] === id) return [];
    const old = this.byKey.get(k);
    if (old) this.byId.delete(old[0]);
    this.byKey.set(k, row);
    this.byId.set(id, row);
    const b = blockOf(z, x, y);
    if (!this.blocks.has(b)) this.blocks.set(b, new Map());
    this.blocks.get(b)!.set(k, id);
    this.maxId = Math.max(this.maxId, id);
    return [k];
  }
}
