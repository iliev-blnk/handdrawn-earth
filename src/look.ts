/** Every colour and weight the map, pad and sheets use. The look sheet swaps whole sets of these. */
export type Look = {
  id: string;
  paper: string;
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
  font: string;
};

/** The spike's look: blue ink on cool grey paper. Placeholder until the look sheet pick. */
export const DEFAULT_LOOK: Look = {
  id: 'spike',
  paper: '#f1f2f4',
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
  font: '"Geist Mono", ui-monospace, Menlo, monospace',
};

export function applyLook(look: Look, root: HTMLElement = document.documentElement) {
  for (const k of ['paper', 'ink', 'hint', 'muted', 'accent', 'water'] as const) root.style.setProperty(`--${k}`, look[k]);
  root.style.setProperty('--font', look.font);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.paper);
}
