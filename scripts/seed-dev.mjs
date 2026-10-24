// Seeds a local API (wrangler dev) with the two drawings from the 2026-10-24 spike, so the map has ink to show.
// Usage: node scripts/seed-dev.mjs [apiBase] [key=spikeIndex ...]
import { readFileSync } from 'node:fs';

const SPIKE = new URL('../../cv-projects/explore/2026-10-24-draw-a-square/drawings.jsonl', import.meta.url);
const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:8787';
const plan = process.argv.slice(2).filter(a => a.includes('=')).map(a => a.split('='));
const spike = readFileSync(SPIKE, 'utf8').trim().split('\n').map(l => JSON.parse(l));

const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

for (const [key, i] of plan.length ? plan : [['0/0/0', 1], ['1/1/0', 0]]) {
  const d = spike[+i], lease = await post('/lease', { key });
  if (!lease.token) { console.log(key, lease.status, lease.error); continue; }
  const res = await post('/draw', { key, token: lease.token, strokes: d.strokes, duration: d.duration, pointer: d.pointerType, started: d.started });
  console.log(key, '←', d.name, res.status, res.id ?? res.error);
}
