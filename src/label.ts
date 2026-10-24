import { centre, kmAcross, key, type Tile } from '../shared/tiles';

const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;

export function across(t: Tile) {
  const km = kmAcross(t);
  if (km >= 100) return `${Math.round(km).toLocaleString('en-US')} km across`;
  return km >= 1 ? `${km.toFixed(1)} km across` : `${Math.round(km * 1000)} m across`;
}

/** The label's second line: `47.0105° N 28.8638° E · 3.1 km across · 12/2376/1440`. */
export function meta(t: Tile) {
  const c = centre(t);
  return `${deg(c.lat, 'N', 'S')} ${deg(c.lon, 'E', 'W')} · ${across(t)} · ${key(t)}`;
}

/** Server errors are lowercase fragments ("every open square is being drawn right now"). */
export const sentence = (s: string) => s[0].toUpperCase() + s.slice(1) + (/[.!?…]$/.test(s) ? '' : '.');

export const OFFLINE = 'No connection. Try again in a moment.';
