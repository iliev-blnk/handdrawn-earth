import { DurableObject } from 'cloudflare:workers';
import { createLand } from './land';
import landBits from './land.bin';
import { doSql } from './sql';
import { World } from './world';

type Env = {
  WORLD: DurableObjectNamespace<WorldDO>;
  ALLOW_ORIGINS: string;
  ADMIN_TOKEN_SHA256: string;
};

const MAX_BODY = 1 << 20;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_Z = 16;

/** The one writer. Methods are called over RPC from the Worker below. */
export class WorldDO extends DurableObject<Env> {
  private world: World;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.world = new World(doSql(ctx.storage), Date.now, Math.random, createLand(new Uint8Array(landBits)));
  }

  hello(lat: unknown, lon: unknown) { return this.world.hello({ latitude: lat, longitude: lon }); }
  index(since: number) { return this.world.index(since); }
  pack(z: number, px: number, py: number) { return this.world.pack(z, px, py); }
  drawing(id: number) { return this.world.drawing(id); }
  lease(ip: string, key?: string) { return this.world.lease(ip, key); }
  draw(ip: string, body: unknown) { return this.world.draw(ip, body); }
  flag(ip: string, id: number) { return this.world.flag(ip, id); }
  hide(id: number) { return this.world.hide(id); }
}

type Out = { body: unknown; status?: number; cache?: string };

const int = (s: string | null | undefined) => (s && /^\d{1,10}$/.test(s) ? Number(s) : null);
const fail = (status: number, error: string): Out => ({ status, body: { error } });
/** World results that carry a status (an error, or a 409 with a fresh lease) pass it through. */
const result = (r: unknown): Out => ({
  body: r,
  status: r && typeof r === 'object' && 'status' in r && typeof r.status === 'number' ? r.status : 200,
});

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

async function route(req: Request, env: Env): Promise<Out> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const world = env.WORLD.get(env.WORLD.idFromName('world'));
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';

  if (req.method === 'GET') {
    if (parts[0] === 'hello' && parts.length === 1) return { body: await world.hello(req.cf?.latitude, req.cf?.longitude) };
    if (parts[0] === 'index' && parts.length === 1) return { body: await world.index(int(url.searchParams.get('since')) ?? 0) };
    if (parts[0] === 'pack' && parts.length === 4) {
      const [z, px, py] = parts.slice(1).map(int);
      const blocks = z === null ? 0 : Math.ceil(2 ** z / 8);
      if (z === null || z > MAX_Z || px === null || py === null || px >= blocks || py >= blocks) return fail(404, 'no such pack');
      return { body: await world.pack(z, px, py), cache: url.searchParams.has('v') ? IMMUTABLE : 'no-store' };
    }
    if (parts[0] === 'd' && parts.length === 2) {
      const id = int(parts[1]);
      const d = id === null ? null : await world.drawing(id);
      return d ? { body: d, cache: IMMUTABLE } : fail(404, 'no such drawing');
    }
    return fail(404, 'not found');
  }

  if (req.method !== 'POST') return fail(405, 'method not allowed');
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return fail(413, 'too big');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY) return fail(413, 'too big');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
    if (!body || typeof body !== 'object') throw 0;
  } catch {
    return fail(400, 'not json');
  }

  const path = parts.join('/');
  if (path === 'lease') {
    if (body.key !== undefined && typeof body.key !== 'string') return fail(400, 'no such square');
    return result(await world.lease(ip, body.key));
  }
  if (path === 'draw') return result(await world.draw(ip, body));
  if (path === 'flag') {
    const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : null;
    return id === null ? fail(400, 'no such drawing') : result(await world.flag(ip, id));
  }
  if (path === 'admin/hide') {
    const ok = env.ADMIN_TOKEN_SHA256 && typeof body.token === 'string' && (await sha256(body.token)) === env.ADMIN_TOKEN_SHA256;
    if (!ok) return fail(403, 'no');
    return typeof body.id === 'number' ? result(await world.hide(body.id)) : fail(400, 'no such drawing');
  }
  return fail(404, 'not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = { Vary: 'Origin' };
    if (origin && env.ALLOW_ORIGINS.split(',').includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      });
    let out: Out;
    try {
      out = await route(req, env);
    } catch (e) {
      console.error(e);
      out = fail(500, 'something broke');
    }
    return Response.json(out.body, { status: out.status ?? 200, headers: { ...cors, 'Cache-Control': out.cache ?? 'no-store' } });
  },
} satisfies ExportedHandler<Env>;
