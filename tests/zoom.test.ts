import { describe, expect, it } from 'vitest';
import { displayLevel, squareZoom, WORLD_ZOOM } from '../src/zoom';

describe('displayLevel', () => {
  it('is the level MapLibre shows: the rounded zoom, one deeper for 256 px squares', () => {
    expect(displayLevel(8.55, 512)).toBe(9);
    expect(displayLevel(8.45, 512)).toBe(8);
    expect(displayLevel(8.55, 256)).toBe(10);
  });

  it('stays between z0 and z16', () => {
    expect(displayLevel(-0.4, 512)).toBe(0);
    expect(displayLevel(17.6, 256)).toBe(16);
  });
});

describe('squareZoom', () => {
  it('lands where the map shows the square itself, not its parent or children', () => {
    for (const square of [512, 256] as const)
      for (const side of [320, 390, 768, 900, 1400, 2200])
        for (let z = 3; z <= 16; z++)
          expect(displayLevel(squareZoom(z, side, square), square), `z${z} side ${side} square ${square}`).toBe(z);
  });

  it('on a phone, a 512 px square fills the width as far as it can', () => {
    expect(squareZoom(9, 390, 512)).toBeCloseTo(8.55);
  });

  it('otherwise makes the square about two thirds of the shorter side', () => {
    expect(512 * 2 ** (squareZoom(9, 900, 512) - 9)).toBeCloseTo(594);
    expect(256 * 2 ** (squareZoom(9, 390, 256) - 8)).toBeCloseTo(257.4);
  });

  it('never goes further out than the whole globe', () => {
    expect(squareZoom(0, 390, 512)).toBe(WORLD_ZOOM);
    expect(squareZoom(1, 900, 256)).toBe(WORLD_ZOOM);
  });
});
