// Renders the four look directions from the same engine, for the look sheet. Each look gets four phone
// screens: the globe, Chișinău around z9, the pad mid-drawing, and a square's replay sheet.
// The world is seeded with the two drawings from the 2026-10-24 spike: a chain of squares down to
// Chișinău takes turns between them. Output: e2e/out/looksheet/<look>/{globe,city,pad,sheet}.jpg
import { mkdirSync, readFileSync } from 'node:fs';
import { idle, launch } from './browser.mjs';
import { startStack } from './stack.mjs';

const LOOKS = (process.argv[2] ?? 'ballpoint,cyanotype,pencil,marker').split(',');
const OUT = new URL('out/looksheet/', import.meta.url).pathname;
const SPIKE = new URL('../../cv-projects/explore/2026-10-24-draw-a-square/drawings.jsonl', import.meta.url);
const [venice, matterhorn] = readFileSync(SPIKE, 'utf8').trim().split('\n').map(l => JSON.parse(l));

const CHISINAU = { lat: 47.0245, lon: 28.8323 };
const tileAt = (lat, lon, z) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { z, x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n) };
};
const key = t => `${t.z}/${t.x}/${t.y}`;
const centre = ({ z, x, y }) => {
  const n = 2 ** z;
  return [((x + 0.5) / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI];
};
const city = tileAt(CHISINAU.lat, CHISINAU.lon, 9);

let stack;
async function seed() {
  // z9, the square the city screen and the sheet show, gets Venice: canals read as streets.
  for (let z = 0; z <= 9; z++) {
    const t = tileAt(CHISINAU.lat, CHISINAU.lon, z), d = z % 2 ? venice : matterhorn;
    const lease = await stack.post('/lease', { key: key(t) });
    const res = await stack.post('/draw', { key: key(t), token: lease.token, strokes: d.strokes, duration: d.duration, pointer: d.pointerType, started: d.started });
    if (!res.id) throw new Error(`seeding ${key(t)}: ${JSON.stringify(res)}`);
  }
}

async function shoot(browser, look) {
  mkdirSync(OUT + look, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log(look, 'pageerror:', e.message));
  const snap = name => page.screenshot({ path: `${OUT}${look}/${name}.jpg`, type: 'jpeg', quality: 86 });
  await page.goto(`${stack.SITE}/?look=${look}`);
  await page.waitForFunction(() => window.__earth?.map, null, { timeout: 30_000 });

  // The globe, turned to face Europe.
  await page.evaluate(() => window.__earth.map.jumpTo({ center: [22, 38], zoom: 1.4 }));
  await idle(page, 30_000);
  await snap('globe');

  // Chișinău, zoomed so the map shows z9 squares: the drawn one, and its neighbours showing their ancestors.
  // 512 px squares show as z9 from 8.5; 256 px ones a level further out (as squareZoom would place them).
  await page.evaluate(c => window.__earth.map.jumpTo({ center: c, zoom: window.__earth.look.square === 256 ? 8.0 : 8.55 }), centre(city));
  await idle(page, 30_000);
  await page.waitForTimeout(400);
  await snap('city');

  // Tap the drawn square: its sheet replays the drawing at twice the speed.
  await page.mouse.click(195, 422);
  await page.waitForFunction(() => document.querySelector('.sheet-made')?.textContent.includes(' s · '), null, { timeout: 15_000 });
  await page.waitForTimeout(venice.duration / 2 + 800);
  await snap('sheet');
  await page.keyboard.press('Escape');

  // The pad on a square one level down, mid-way through tracing the Matterhorn drawing by hand.
  const child = { z: 10, x: city.x * 2 + 1, y: city.y * 2 };
  await page.evaluate(async k => window.__earth.pad.open(await window.__earth.api.lease(k)), key(child));
  await page.waitForFunction(() => document.querySelector('.pad-hint').textContent.startsWith('The 60'), null, { timeout: 20_000 });
  await page.waitForTimeout(600);
  const r = await page.locator('.pad-ink').boundingBox();
  for (const s of matterhorn.strokes.slice(0, 4)) {
    const at = p => [r.x + p[0] * r.width, r.y + p[1] * r.height];
    await page.mouse.move(...at(s[0]));
    await page.mouse.down();
    for (const p of s.filter((_, i) => i % 2 === 0)) await page.mouse.move(...at(p));
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  await snap('pad');
  // Leave the square undrawn, so the next look gets it too.
  await page.evaluate(() => sessionStorage.clear());
  await page.close();
  console.log(look, 'done');
}

try {
  stack = await startStack({ apiPort: 8792, sitePort: 5182, inspectorPort: 9332 });
  await seed();
  const browser = await launch();
  try {
    for (const look of LOOKS) await shoot(browser, look);
  } finally {
    await browser.close();
  }
} catch (e) {
  console.error(`looksheet: ${e.message}`);
  if (stack) console.error(stack.logs());
  process.exitCode = 1;
} finally {
  stack?.stop();
}
