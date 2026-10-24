/** Every colour and weight the map, pad and sheets use. The look sheet swaps whole sets of these. */
export type Look = {
  id: string;
  paper: string;
  /** Behind the globe, where there is no Earth. */
  space: string;
  ink: string;
  /** Tracing hint: roads, borders, building outlines. */
  hint: string;
  muted: string;
  /** Squares drawn in the last 24 h. Corner crosshairs only. */
  accent: string;
  water: string;
  waterLine: string;
  /** Line width in px on a 512 px square. */
  inkWidth: number;
  /** Outline strength of undrawn squares, 0 to 1. */
  grid: number;
  /** How present the real map is under the ink, 0 to 1. */
  basemap: number;
  globe: boolean;
  /** A square's side on screen at its own level, in px: 512 shows one at a time on a phone, 256 a patchwork. */
  square: 512 | 256;
  /** Label chrome: boxed labels, plain (no boxes), or bare (no boxes, no coordinates). */
  chrome: 'boxed' | 'plain' | 'bare';
  font: string;
};

const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

/** The four directions from the look sheet. Each changes the ink and paper and one or two toggles. */
export const LOOKS: Record<string, Look> = {
  // The spike's look: blue ballpoint on cool grey paper.
  ballpoint: {
    id: 'ballpoint',
    paper: '#f1f2f4',
    space: '#f1f2f4',
    ink: '#0d2f8a',
    hint: '#a7afc0',
    muted: '#6b7385',
    accent: '#e2471e',
    water: '#dde3ee',
    waterLine: '#9fb0cc',
    inkWidth: 2.4,
    grid: 0.5,
    basemap: 1,
    globe: true,
    square: 512,
    chrome: 'boxed',
    font: MONO,
  },
  // White on Prussian blue, the sun-print process. Smaller squares: a patchwork on a phone.
  cyanotype: {
    id: 'cyanotype',
    paper: '#12396b',
    space: '#0a2142',
    ink: '#f2f6fb',
    hint: '#4f75a6',
    muted: '#9db4d3',
    accent: '#ffd23f',
    water: '#0e3160',
    waterLine: '#3d659a',
    inkWidth: 3.2,
    grid: 0.45,
    basemap: 0.85,
    globe: true,
    square: 256,
    chrome: 'boxed',
    font: MONO,
  },
  // Graphite on a flat map, a red pencil for the newest squares.
  pencil: {
    id: 'pencil',
    paper: '#f5f5f3',
    space: '#f5f5f3',
    ink: '#3a3d42',
    hint: '#c4c7cc',
    muted: '#80848b',
    accent: '#d7261e',
    water: '#e8eaed',
    waterLine: '#b9bec6',
    inkWidth: 1.7,
    grid: 0.35,
    basemap: 0.6,
    globe: false,
    square: 512,
    chrome: 'plain',
    font: MONO,
  },
  // Thick black felt tip on white, the real map barely there, in a patchwork of small squares.
  marker: {
    id: 'marker',
    paper: '#ffffff',
    space: '#ffffff',
    ink: '#111111',
    hint: '#bdbdbd',
    muted: '#6e6e6e',
    accent: '#1f5bff',
    water: '#eef2f6',
    waterLine: '#c5ced8',
    inkWidth: 3.6,
    grid: 0.25,
    basemap: 0.35,
    globe: true,
    square: 256,
    chrome: 'bare',
    font: MONO,
  },
};

/** Cyanotype, picked from the look sheet on 2026-10-25. */
export const DEFAULT_LOOK: Look = LOOKS.cyanotype;

/** `?look=<id>` picks a direction, for the look sheet. Anything else gets the default. */
export function pickLook(search: string): Look {
  const id = new URLSearchParams(search).get('look') ?? '';
  return Object.hasOwn(LOOKS, id) ? LOOKS[id] : DEFAULT_LOOK;
}

export function applyLook(look: Look, root: HTMLElement = document.documentElement) {
  for (const k of ['paper', 'ink', 'hint', 'muted', 'accent', 'water'] as const) root.style.setProperty(`--${k}`, look[k]);
  root.style.setProperty('--font', look.font);
  root.dataset.chrome = look.chrome;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.paper);
}
