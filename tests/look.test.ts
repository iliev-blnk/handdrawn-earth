import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOKS, pickLook } from '../src/look';

describe('pickLook', () => {
  it('takes the look named in ?look=', () => {
    expect(pickLook('?look=cyanotype').id).toBe('cyanotype');
    expect(pickLook('?x=1&look=marker').id).toBe('marker');
  });

  it('defaults to the picked look, cyanotype', () => {
    expect(DEFAULT_LOOK.id).toBe('cyanotype');
  });

  it('falls back to the default for no name or an unknown one', () => {
    expect(pickLook('')).toBe(DEFAULT_LOOK);
    expect(pickLook('?look=nope')).toBe(DEFAULT_LOOK);
    expect(pickLook('?look=toString')).toBe(DEFAULT_LOOK);
  });
});

describe('LOOKS', () => {
  it('has four directions keyed by their own id, the default among them', () => {
    expect(Object.keys(LOOKS)).toHaveLength(4);
    for (const [id, look] of Object.entries(LOOKS)) expect(look.id).toBe(id);
    expect(LOOKS[DEFAULT_LOOK.id]).toBe(DEFAULT_LOOK);
  });

  it('gives every colour as a six-digit hex', () => {
    for (const look of Object.values(LOOKS))
      for (const k of ['paper', 'space', 'ink', 'hint', 'muted', 'accent', 'water', 'waterLine'] as const)
        expect(look[k], `${look.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('sets the picked globe off from the space around it, so a drawn-over world keeps its edge', () => {
    expect(DEFAULT_LOOK.space).not.toBe(DEFAULT_LOOK.paper);
  });

  it('shows squares at 512 or 256 px', () => {
    for (const look of Object.values(LOOKS)) expect([512, 256]).toContain(look.square);
  });

  it('keeps basemap and grid strengths between 0 and 1', () => {
    for (const { basemap, grid } of Object.values(LOOKS)) {
      expect(basemap).toBeGreaterThanOrEqual(0);
      expect(basemap).toBeLessThanOrEqual(1);
      expect(grid).toBeGreaterThanOrEqual(0);
      expect(grid).toBeLessThanOrEqual(1);
    }
  });
});
