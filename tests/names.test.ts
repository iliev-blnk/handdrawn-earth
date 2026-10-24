import { describe, expect, it } from 'vitest';
import { tileAt } from '../shared/tiles';
import { pickName } from '../src/names';

const pt = (cls: string, name: string, lat: number, lon: number, extra: Record<string, unknown> = {}) =>
  ({ properties: { class: cls, name, ...extra }, geometry: { type: 'Point', coordinates: [lon, lat] } });

const chisinau = tileAt(47.02, 28.83, 10);

describe('pickName', () => {
  it('takes the biggest kind of place inside the square, and nothing outside it', () => {
    const places = [
      pt('village', 'Durlești', 47.03, 28.76),
      pt('city', 'Chișinău', 47.02, 28.83),
      pt('city', 'Bălți', 47.76, 27.93),
    ];
    expect(pickName(places, [], tileAt(47.02, 28.83, 9))).toBe('Chișinău');
    expect(pickName([pt('suburb', 'Botanica', 46.98, 28.86)], [], tileAt(46.98, 28.86, 13))).toBe('Botanica');
  });

  it('breaks ties by rank and prefers the English or Latin spelling', () => {
    const t = tileAt(55.75, 37.62, 6);
    const places = [
      pt('city', 'Тула', 54.19, 37.62, { rank: 6 }),
      pt('city', 'Москва', 55.75, 37.62, { rank: 1, 'name:latin': 'Moskva', 'name:en': 'Moscow' }),
    ];
    expect(pickName(places, [], t)).toBe('Moscow');
    expect(pickName([pt('city', 'Москва', 55.75, 37.62, { 'name:latin': 'Moskva' })], [], t)).toBe('Moskva');
  });

  it('falls back to water, then to coordinates', () => {
    const sea = tileAt(43.4, 34.2, 7);
    expect(pickName([], [pt('sea', 'Black Sea', 43.4, 34.2)], sea)).toBe('Black Sea');
    expect(pickName([], [], chisinau)).toMatch(/^4\d\.\d\d°N 2\d\.\d\d°E$/);
    expect(pickName([], [], tileAt(-33.9, -70.6, 8))).toMatch(/°S 7\d\.\d\d°W$/);
  });

  it('the first square is the whole planet', () => {
    expect(pickName([pt('country', 'Brazil', -10, -55)], [], { z: 0, x: 0, y: 0 })).toBe('Earth');
  });
});
