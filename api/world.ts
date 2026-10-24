import { b64, encodeDisplay, encodeStrokes } from '../shared/codec';
import { children, key, MAX_Z, neighbours, parent, parse, type Tile } from '../shared/tiles';
import type { DrawingOut, IndexRow, Lease, PackRow, PointerKind } from '../shared/types';
import { validateDrawing, validKey } from '../shared/validate';
import { Frontier } from './frontier';
import type { Sql } from './sql';

export const LEASE_MS = 180_000;
/** A saved draft can be retried for a day; after that the token is stale. */
const TOKEN_MAX_AGE = 24 * 3_600_000;
const HOUR = 3_600_000;
const DRAWS_PER_HOUR = 20, FLAGS_PER_HOUR = 30, FLAGS_TO_HIDE = 3;
/** Packs are 8×8 squares of one level. */
const PACK = 8;

export type Fail = { status: number; error: string };
export type DrawResult = { id: number } | { status: 409; error: string; lease: Lease | null } | Fail;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY,
    z INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
    full BLOB NOT NULL, display BLOB NOT NULL,
    duration INTEGER NOT NULL, pointer TEXT NOT NULL, started_at TEXT NOT NULL,
    created_at INTEGER NOT NULL, ip_hash TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)`,
  // First save wins: one visible drawing per square. Hidden ones step aside.
  'CREATE UNIQUE INDEX IF NOT EXISTS drawings_square ON drawings (z, x, y) WHERE hidden = 0',
  `CREATE TABLE IF NOT EXISTS flags (
    drawing_id INTEGER NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (drawing_id, ip_hash))`,
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
];

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

/**
 * The whole world. One instance lives in the Durable Object and is the only writer:
 * SQLite holds the drawings, memory holds the index, the frontier, leases and rate limits.
 * Every check-then-write runs without an await in between, so two Keeps can't both win.
 */
export class World {
  private rows: IndexRow[] = [];
  private drawn = new Map<string, number>();
  private hiddenIds: number[] = [];
  private frontier = new Frontier();
  private leases = new Map<string, { who: string; expires: number }>();
  private leaseOf = new Map<string, string>();
  private drawsBy = new Map<string, number[]>();
  private flagsBy = new Map<string, number[]>();
  private salt: string;
  private macKey?: Promise<CryptoKey>;

  constructor(
    private sql: Sql,
    private now: () => number,
    private rand: () => number,
    private land: (t: Tile) => number = () => 1,
  ) {
    for (const s of SCHEMA) sql(s);
    this.salt = this.loadSalt();
    for (const r of sql('SELECT id, z, x, y, created_at FROM drawings WHERE hidden = 0 ORDER BY id')) {
      const row: IndexRow = [r.id as number, r.z as number, r.x as number, r.y as number, Math.floor((r.created_at as number) / 1000)];
      this.rows.push(row);
      this.drawn.set(`${row[1]}/${row[2]}/${row[3]}`, row[0]);
    }
    this.hiddenIds = sql('SELECT id FROM drawings WHERE hidden = 1 ORDER BY id').map(r => r.id as number);
    this.open({ z: 0, x: 0, y: 0 });
    for (const k of this.drawn.keys()) this.openChildren(parse(k));
  }

  hello(cf: { latitude?: unknown; longitude?: unknown }) {
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    return { lat: num(cf.latitude), lon: num(cf.longitude), count: this.drawn.size };
  }

  /** Visible drawings newer than `since`, and which of the older ones have been hidden. */
  index(since: number): { rows: IndexRow[]; hidden: number[]; count: number } {
    return {
      rows: this.rows.slice(this.firstAfter(since)),
      hidden: since > 0 ? this.hiddenIds.filter(id => id <= since) : [],
      count: this.drawn.size,
    };
  }

  /** Display geometry for one 8×8 block of level z. `v` is the newest id in it, the client's cache key. */
  pack(z: number, px: number, py: number): { v: number; rows: PackRow[] } {
    const rows = this.sql(
      'SELECT id, x, y, display FROM drawings WHERE hidden = 0 AND z = ? AND x >= ? AND x < ? AND y >= ? AND y < ? ORDER BY id',
      z, px * PACK, (px + 1) * PACK, py * PACK, (py + 1) * PACK,
    ).map(r => ({ id: r.id as number, x: r.x as number, y: r.y as number, d: b64(r.display as Uint8Array) }));
    return { v: rows.reduce((m, r) => Math.max(m, r.id), 0), rows };
  }

  /** The full drawing with timing, for replay. */
  drawing(id: number): DrawingOut | null {
    const r = this.sql(
      'SELECT id, z, x, y, full, duration, pointer, created_at FROM drawings WHERE id = ? AND hidden = 0', id,
    )[0];
    if (!r) return null;
    return {
      id, key: `${r.z}/${r.x}/${r.y}`, strokes: b64(r.full as Uint8Array), duration: r.duration as number,
      pointer: r.pointer as PointerKind, created: Math.floor((r.created_at as number) / 1000),
    };
  }

  /** Reserve a square for three minutes: the one asked for, or a weighted pick from the frontier. */
  async lease(ip: string, k?: string): Promise<Lease | Fail> {
    return this.leaseFor(await this.ipHash(ip), k);
  }

  async draw(ip: string, input: unknown): Promise<DrawResult> {
    const v = validateDrawing(input);
    if (!v.ok) return { status: 400, error: v.error };
    const d = v.value;
    const who = await this.ipHash(ip);
    if (!(await this.tokenOk(d.key, d.token))) return { status: 403, error: 'this square was not leased to you' };

    // No awaits from here to the insert.
    const now = this.now();
    const recent = this.recent(this.drawsBy, who, now);
    if (recent.length >= DRAWS_PER_HOUR) return { status: 429, error: 'twenty squares an hour is the limit' };
    if (this.drawn.has(d.key)) return this.taken(who);
    if (!this.frontier.has(d.key)) return { status: 422, error: 'draw its parent first' };

    const t = parse(d.key);
    let id: number;
    try {
      id = this.sql(
        `INSERT INTO drawings (z, x, y, full, display, duration, pointer, started_at, created_at, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        t.z, t.x, t.y, encodeStrokes(d.strokes), encodeDisplay(d.strokes),
        Math.round(d.duration), d.pointer, d.started, now, who,
      )[0].id as number;
    } catch (e) {
      if (String(e).includes('UNIQUE')) return this.taken(who);
      throw e;
    }

    recent.push(now);
    this.rows.push([id, t.z, t.x, t.y, Math.floor(now / 1000)]);
    this.drawn.set(d.key, id);
    this.frontier.delete(d.key);
    this.openChildren(t);
    const held = this.leases.get(d.key);
    if (held) {
      this.leases.delete(d.key);
      if (this.leaseOf.get(held.who) === d.key) this.leaseOf.delete(held.who);
    }
    return { id };
  }

  /** Three flags from different people hide a drawing and put its square back on the frontier. */
  async flag(ip: string, id: number): Promise<{ hidden: boolean } | Fail> {
    const who = await this.ipHash(ip);
    const now = this.now();
    if (!this.sql('SELECT 1 FROM drawings WHERE id = ? AND hidden = 0', id).length)
      return { status: 404, error: 'no such drawing' };
    const recent = this.recent(this.flagsBy, who, now);
    if (recent.length >= FLAGS_PER_HOUR) return { status: 429, error: 'too many flags this hour' };
    recent.push(now);
    this.sql('INSERT OR IGNORE INTO flags (drawing_id, ip_hash, created_at) VALUES (?, ?, ?)', id, who, now);
    const n = this.sql('SELECT COUNT(*) AS n FROM flags WHERE drawing_id = ?', id)[0].n as number;
    if (n < FLAGS_TO_HIDE) return { hidden: false };
    this.hide(id);
    return { hidden: true };
  }

  hide(id: number): { ok: boolean } {
    const r = this.sql('UPDATE drawings SET hidden = 1 WHERE id = ? AND hidden = 0 RETURNING z, x, y', id)[0];
    if (!r) return { ok: false };
    const t: Tile = { z: r.z as number, x: r.x as number, y: r.y as number };
    this.drawn.delete(key(t));
    const i = this.firstAfter(id - 1);
    if (this.rows[i]?.[0] === id) this.rows.splice(i, 1);
    this.hiddenIds.push(id);
    // Drawn children stay; the empty ones wait for this square to be drawn again.
    for (const c of children(t)) this.frontier.delete(key(c));
    this.open(t);
    return { ok: true };
  }

  private async leaseFor(who: string, k?: string): Promise<Lease | Fail> {
    const now = this.now();
    this.release(who);
    if (k === undefined) {
      const pick = this.frontier.pick(this.rand, this.liveLeases(now));
      if (pick === null) return { status: 503, error: 'every open square is being drawn right now' };
      k = pick;
    } else {
      if (!validKey(k)) return { status: 400, error: 'no such square' };
      if (this.drawn.has(k)) return { status: 409, error: 'already drawn' };
      if (!this.frontier.has(k)) return { status: 422, error: 'draw its parent first' };
      const held = this.leases.get(k);
      if (held && held.expires > now) return { status: 423, error: 'someone is drawing this square right now' };
    }
    // Reserve before the first await, sign after.
    const expires = now + LEASE_MS;
    this.leases.set(k, { who, expires });
    this.leaseOf.set(who, k);
    const t = parse(k), p = parent(t);
    const ids = (ts: Tile[]) => ts.flatMap(n => this.drawn.get(key(n)) ?? []);
    return {
      key: k, token: await this.token(k, now), expires,
      parent: p ? (this.drawn.get(key(p)) ?? null) : null,
      neighbours: ids(neighbours(t)),
    };
  }

  /** 409: someone else's drawing landed first. Hand back a fresh square to draw instead. */
  private async taken(who: string): Promise<DrawResult> {
    const lease = await this.leaseFor(who);
    return { status: 409, error: 'someone else drew this square first', lease: 'error' in lease ? null : lease };
  }

  private release(who: string) {
    const k = this.leaseOf.get(who);
    if (k === undefined) return;
    this.leaseOf.delete(who);
    if (this.leases.get(k)?.who === who) this.leases.delete(k);
  }

  private liveLeases(now: number) {
    const live = new Set<string>();
    for (const [k, l] of this.leases) {
      if (l.expires > now) { live.add(k); continue; }
      this.leases.delete(k);
      if (this.leaseOf.get(l.who) === k) this.leaseOf.delete(l.who);
    }
    return live;
  }

  /** Squares that can be drawn now: undrawn, with a drawn parent, no deeper than z16. */
  private open(t: Tile) {
    const k = key(t), p = parent(t);
    if (t.z > MAX_Z || this.drawn.has(k) || (p && !this.drawn.has(key(p)))) return;
    this.frontier.add(k, Math.max(0.12, this.land(t)) * 0.55 ** t.z);
  }

  private openChildren(t: Tile) {
    if (t.z < MAX_Z) for (const c of children(t)) this.open(c);
  }

  /** First index in `rows` with an id above `id`. */
  private firstAfter(id: number) {
    let lo = 0, hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid][0] > id) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Timestamps from the last hour for one person; the returned array is live, push to it. */
  private recent(log: Map<string, number[]>, who: string, now: number) {
    if (log.size > 10_000)
      for (const [k, l] of log) if (!l.length || l[l.length - 1] <= now - HOUR) log.delete(k);
    const list = (log.get(who) ?? []).filter(t => t > now - HOUR);
    log.set(who, list);
    return list;
  }

  private loadSalt(): string {
    const r = this.sql("SELECT v FROM meta WHERE k = 'salt'")[0];
    if (r) return r.v as string;
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.sql("INSERT INTO meta (k, v) VALUES ('salt', ?)", salt);
    return salt;
  }

  private async mac(msg: string) {
    this.macKey ??= crypto.subtle.importKey('raw', enc.encode(this.salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC', await this.macKey, enc.encode(msg))));
  }

  private async ipHash(ip: string) {
    return (await this.mac(`ip|${ip}`)).slice(0, 16);
  }

  /** Stateless, so a lease survives the Durable Object restarting: issued time plus a signature over square and time. */
  private async token(k: string, issued: number) {
    return `${issued.toString(36)}.${(await this.mac(`lease|${k}|${issued}`)).slice(0, 32)}`;
  }

  private async tokenOk(k: string, token: string) {
    const issued = parseInt(token.split('.')[0], 36), now = this.now();
    if (!Number.isFinite(issued) || issued > now + 60_000 || now - issued > TOKEN_MAX_AGE) return false;
    return (await this.token(k, issued)) === token;
  }
}
