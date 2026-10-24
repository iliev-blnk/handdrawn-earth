// Headless Chromium for checks and the smoke test. Uses the system browser; set CHROMIUM to override.
import { chromium } from 'playwright-core';

export const SITE = process.env.SITE ?? 'http://localhost:5173';

export async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** Resolves once the map has drawn every tile it wants for the current view, or after `ms` regardless. */
export const idle = (page, ms = 15000) => page.evaluate(ms => new Promise(r => {
  const m = window.__earth.map, end = setTimeout(() => r(false), ms);
  const check = () => (m.loaded() && m.areTilesLoaded() ? (clearTimeout(end), r(true)) : m.once('idle', check));
  check();
}), ms);
