// Checks the deployed site and API and leaves nothing behind. On an empty world it also walks the write path:
// it draws 0/0/0, reads it back, hides it with the admin token, and checks the world is empty again.
// Usage: E2E_BASE=https://handdrawn-earth.pages.dev E2E_API=https://handdrawn-earth-api.<you>.workers.dev pnpm live
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { idle, launch } from './browser.mjs';

const SITE = process.env.E2E_BASE ?? 'https://handdrawn-earth.pages.dev';
const API = process.env.E2E_API;
const OUT = new URL('out/live/', import.meta.url).pathname;
const TOKEN = `${homedir()}/.config/handdrawn-earth/admin-token`;

const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) throw new Error(name);
};
const get = async path => {
  const r = await fetch(API + path, { headers: { Origin: SITE } });
  return { r, body: await r.json() };
};
const post = async (path, body) => {
  const r = await fetch(API + path, { method: 'POST', headers: { Origin: SITE }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

async function writePath() {
  const lease = await post('/lease', { key: '0/0/0' });
  ok('an empty world leases the whole world', lease.key === '0/0/0' && !!lease.token, lease.error);
  const pts = Array.from({ length: 24 }, (_, i) => [0.2 + i * 0.025, 0.5 + 0.1 * Math.sin(i / 3), i * 40]);
  const drawn = await post('/draw', { key: '0/0/0', token: lease.token, strokes: [pts], duration: 1000, pointer: 'mouse', started: new Date().toISOString() });
  ok('a drawing saves', !!drawn.id, drawn.error);
  try {
    const d = await get(`/d/${drawn.id}`);
    ok('and reads back for the replay', d.r.ok && d.body.key === '0/0/0');
    const pack = await get(`/pack/0/0/0?v=${drawn.id}`);
    ok('and shows in its pack', !!pack.body.rows?.some(r => r.id === drawn.id));
  } finally {
    const hidden = await post('/admin/hide', { token: readFileSync(TOKEN, 'utf8').trim(), id: drawn.id });
    ok('the test drawing is hidden again', hidden.ok === true, hidden.error);
  }
  const after = await get('/hello');
  ok('and the world is empty again', after.body.count === 0, `${after.body.count} squares`);
}

async function main() {
  if (!API) throw new Error('set E2E_API to the API url');
  const hello = await get('/hello');
  ok('the API answers', hello.r.ok, `${hello.body.count} squares`);
  ok('and lets the site call it', hello.r.headers.get('access-control-allow-origin') === SITE);
  if (hello.body.count === 0) await writePath();
  else console.log('skip the write path: the world already has drawings');

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const called = page.waitForRequest(r => r.url().startsWith(`${API}/index`), { timeout: 30_000 });
    await page.goto(SITE);
    await called;
    ok('the site talks to this API', true);
    await page.waitForFunction(() => window.__earth?.map, null, { timeout: 30_000 });
    await idle(page, 30_000);
    const count = await page.textContent('.shell-count');
    ok('the site loads and counts the world', /^[\d,]+ squares? drawn$/.test(count), count);
    ok('in the picked look', await page.evaluate(() => window.__earth.look.id) === 'cyanotype');
    ok('with no page errors', errors.length === 0, errors.join('; '));
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}globe.jpg`, type: 'jpeg', quality: 86 });
  } finally {
    await browser.close();
  }
  console.log(`live: all passed (screenshot ${OUT}globe.jpg)`);
}

main().catch(e => {
  console.error(`live: ${e.message}`);
  process.exitCode = 1;
});
