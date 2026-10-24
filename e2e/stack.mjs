// A throwaway world on spare ports: its own API with fresh storage, and the site pointed at it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

async function up(url, ms = 90_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 300)))
    try { if ((await fetch(url)).ok) return; } catch {}
  throw new Error(`${url} never came up`);
}

export async function startStack({ apiPort, sitePort, inspectorPort }) {
  const API = `http://localhost:${apiPort}`, SITE = `http://localhost:${sitePort}`;
  const persist = mkdtempSync(join(tmpdir(), 'hde-stack-'));
  const kids = [];
  const run = (args, env = {}) => {
    const p = spawn('pnpm', ['exec', ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const kid = { name: args[0], out: '', p };
    p.stdout.on('data', d => { kid.out += d; });
    p.stderr.on('data', d => { kid.out += d; });
    kids.push(kid);
  };
  const stop = () => {
    for (const { p } of kids) try { process.kill(-p.pid, 'SIGTERM'); } catch {}
    rmSync(persist, { recursive: true, force: true });
  };
  run(['wrangler', 'dev', '--config', 'api/wrangler.jsonc', '--port', String(apiPort), '--inspector-port', String(inspectorPort),
    '--persist-to', persist, '--var', `ALLOW_ORIGINS:${SITE}`]);
  run(['vite', '--port', String(sitePort), '--strictPort'], { VITE_API: API });
  try {
    await Promise.all([up(`${API}/hello`), up(SITE)]);
  } catch (e) {
    stop();
    throw e;
  }
  const post = async (path, body) => (await fetch(API + path, { method: 'POST', body: JSON.stringify(body) })).json();
  /** The last lines each server printed, for a failure report. */
  const logs = () => kids.map(k => `--- ${k.name}\n${k.out.slice(-1500)}`).join('\n');
  return { API, SITE, post, stop, logs };
}
