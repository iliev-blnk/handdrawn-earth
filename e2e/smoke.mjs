// End to end on a throwaway world: its own API (fresh storage) and its own site, on spare ports.
// Walks the paths a person can hit that unit tests can't: a resize between strokes, Keep on a dead
// network then a retry, and losing a square to someone who saved first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const API_PORT = 8791, SITE_PORT = 5181, INSPECTOR_PORT = 9331;
const API = `http://localhost:${API_PORT}`, SITE = `http://localhost:${SITE_PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;
const persist = mkdtempSync(join(tmpdir(), 'hde-smoke-'));
const kids = [];

function run(args, env = {}) {
  const p = spawn('pnpm', ['exec', ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const kid = { name: args[0], out: '' };
  p.stdout.on('data', d => { kid.out += d; });
  p.stderr.on('data', d => { kid.out += d; });
  kid.p = p;
  kids.push(kid);
}
async function up(url, ms = 90_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 300)))
    try { if ((await fetch(url)).ok) return; } catch {}
  throw new Error(`${url} never came up`);
}
function stop() {
  for (const { p } of kids) try { process.kill(-p.pid, 'SIGTERM'); } catch {}
  rmSync(persist, { recursive: true, force: true });
}
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) throw new Error(name);
};
const post = async (path, body) => (await fetch(API + path, { method: 'POST', body: JSON.stringify(body) })).json();

async function main() {
  run(['wrangler', 'dev', '--config', 'api/wrangler.jsonc', '--port', String(API_PORT), '--inspector-port', String(INSPECTOR_PORT),
    '--persist-to', persist, '--var', `ALLOW_ORIGINS:${SITE}`]);
  run(['vite', '--port', String(SITE_PORT), '--strictPort'], { VITE_API: API });
  await Promise.all([up(`${API}/hello`), up(SITE)]);

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    page.on('pageerror', e => console.log('pageerror:', e.message));
    await page.goto(SITE);
    await page.waitForFunction(() => window.__earth?.pad, null, { timeout: 30_000 });
    ok('an empty world counts zero', (await page.textContent('.shell-count')) === '0 squares drawn');

    const padKey = async () => (await page.textContent('.pad-meta')).split(' · ').pop();
    const traced = () => page.waitForFunction(() => document.querySelector('.pad-hint').textContent.startsWith('The 60'), null, { timeout: 20_000 });
    const hint = () => page.textContent('.pad-hint');
    const state = s => page.waitForFunction(s => window.__earth.pad.state === s, s, { timeout: 15_000 });
    const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('hde:draft')));
    async function stroke(pts) {
      const r = await page.locator('.pad-ink').boundingBox();
      const at = ([x, y]) => [r.x + x * r.width, r.y + y * r.height];
      await page.mouse.move(...at(pts[0]));
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 8 });
      await page.mouse.up();
    }

    // A resize between strokes, then Keep with the API unreachable, then a retry.
    await page.click('.shell-draw');
    await traced();
    const first = await padKey();
    ok('the first square is the whole world', first === '0/0/0', first);
    await stroke([[0.1, 0.2], [0.4, 0.5], [0.7, 0.3], [0.9, 0.8]]);
    await page.setViewportSize({ width: 420, height: 860 });
    await page.waitForTimeout(600);
    await stroke([[0.2, 0.9], [0.5, 0.6], [0.8, 0.95]]);
    await page.click('[data-act="done"]');
    await page.route('**/draw', r => r.abort('internetdisconnected'));
    await page.click('[data-act="keep"]');
    await state('failed');
    ok('Keep on a dead network says it was not saved', (await hint()).startsWith('Not saved'), await hint());
    ok('and offers Try again', await page.isVisible('[data-act="retry"]'));
    ok('the draft is still in sessionStorage', (await draft())?.strokes.length === 2);
    await page.unroute('**/draw');
    const sent = page.waitForRequest(r => r.url().endsWith('/draw') && r.method() === 'POST');
    await page.click('[data-act="retry"]');
    const body = JSON.parse((await sent).postData());
    ok('the retry sends both strokes, from before and after the resize', body.strokes.length === 2, `${body.strokes.map(s => s.length)} points`);
    await page.waitForFunction(() => !window.__earth.pad.isOpen, null, { timeout: 15_000 });
    ok('once saved the draft is gone', (await draft()) === null);
    ok('the count goes up', (await page.textContent('.shell-count')) === '1 square drawn');
    ok('the sheet opens on the new square', (await page.evaluate(() => location.hash)) === '#0/0/0');

    // Someone else saves the same square first.
    await page.keyboard.press('Escape');
    await page.click('.shell-draw');
    await traced();
    const second = await padKey();
    await stroke([[0.1, 0.1], [0.5, 0.9], [0.9, 0.1]]);
    await page.click('[data-act="done"]');
    // Same IP as the page, so this lease simply replaces the page's.
    const lease = await post('/lease', { key: second });
    const pts = Array.from({ length: 12 }, (_, i) => [0.1 + i * 0.07, 0.5, i * 100]);
    const theirs = await post('/draw', { key: second, token: lease.token, strokes: [pts], duration: 1200, pointer: 'mouse', started: new Date().toISOString() });
    ok('the other visitor saved first', typeof theirs.id === 'number', JSON.stringify(theirs));
    await page.click('[data-act="keep"]');
    await state('taken');
    ok('the loser is told plainly', (await hint()) === 'Someone else drew this square first.');
    ok('and offered another square', await page.isVisible('[data-act="another"]'));
    await page.click('[data-act="another"]');
    await traced();
    const third = await padKey();
    ok('Draw another opens a different square', third !== second && third !== first, `${second} → ${third}`);
    await page.click('[data-act="back"]');

    // A square link opens its sheet.
    const linked = await browser.newPage({ viewport: { width: 420, height: 860 } });
    await linked.goto(`${SITE}/#${second}`);
    await linked.waitForFunction(() => window.__earth?.sheet.current, null, { timeout: 30_000 });
    await linked.waitForFunction(() => !document.querySelector('.sheet-made').textContent.startsWith('Loading'), null, { timeout: 15_000 });
    ok('#z/x/y opens that square', (await linked.evaluate(() => window.__earth.sheet.current)).x === +second.split('/')[1]);
    ok('and replays the drawing that won', /^1 s · mouse · /.test(await linked.textContent('.sheet-made')), await linked.textContent('.sheet-made'));
  } finally {
    await browser.close();
  }
}

try {
  await main();
  console.log('smoke: all passed');
} catch (e) {
  console.error(`smoke: ${e.message}`);
  for (const k of kids) console.error(`--- ${k.name}\n${k.out.slice(-1500)}`);
  process.exitCode = 1;
} finally {
  stop();
}
