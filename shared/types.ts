/** [x, y, tMs, pressure?]: x and y are fractions of the square's side, t counts from the first line. */
export type Point = [number, number, number] | [number, number, number, number];
export type Stroke = Point[];
/** Display geometry has no timing: [x, y]. */
export type DisplayStroke = [number, number][];

export type PointerKind = 'mouse' | 'pen' | 'touch';

export type DrawingIn = {
  key: string;
  token: string;
  strokes: Stroke[];
  duration: number;
  pointer: PointerKind;
  started: string;
};

/** [id, z, x, y, createdSec] */
export type IndexRow = [number, number, number, number, number];

export type PackRow = { id: number; x: number; y: number; d: string };

export type Lease = { key: string; token: string; expires: number; parent: number | null; neighbours: number[] };

export type DrawingOut = {
  id: number;
  key: string;
  strokes: string;
  duration: number;
  pointer: PointerKind;
  created: number;
};
