const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The character a Song's Cover placeholder shows: the title's first letter or
 * digit, capitalised, past any leading punctuation or symbols. A title with
 * neither shows its first character as it is.
 */
export function coverInitial(title: string): string {
  const chars = [...graphemes.segment(title.normalize('NFC'))].map((s) => s.segment).filter((c) => c.trim() !== '');
  const first = chars.find((c) => /^[\p{L}\p{N}]/u.test(c)) ?? chars[0] ?? '';
  const upper = first.toLocaleUpperCase();
  // Some letters capitalise to two (ß to SS); those stay as they are.
  return [...graphemes.segment(upper)].length === 1 ? upper : first;
}

/** A size in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** A square of a picture, in its pixels. */
export interface Square {
  x: number;
  y: number;
  size: number;
}

/** A picture's size scaled down, keeping its shape, so neither side is over max. */
export function fitWithin(width: number, height: number, max: number): Size {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The largest square of a picture, centred. */
export function centredSquare(width: number, height: number): Square {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

/** How far a Cover's crop square zooms in on the largest square. */
export const maxCoverZoom = 8;

/** A point in a picture, in its pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A square made to fit a picture: no larger than its largest square, so it
 * never shows bars, no smaller than zoomed all the way in, and inside it.
 */
export function clampSquare(square: Square, width: number, height: number): Square {
  const largest = Math.min(width, height);
  const size = Math.min(largest, Math.max(square.size, largest / maxCoverZoom, 1));
  return {
    x: Math.min(Math.max(square.x, 0), width - size),
    y: Math.min(Math.max(square.y, 0), height - size),
    size,
  };
}

/** A square moved by the given pixels, stopping at the picture's edges. */
export function moveSquare(square: Square, dx: number, dy: number, width: number, height: number): Square {
  return clampSquare({ ...square, x: square.x + dx, y: square.y + dy }, width, height);
}

/**
 * A square zoomed to a size, keeping the point zoomed on where it was in the
 * square, as far as the picture's edges let it.
 */
export function zoomSquare(square: Square, size: number, on: Point, width: number, height: number): Square {
  const next = clampSquare({ ...square, size }, width, height).size;
  const scale = next / square.size;
  return clampSquare(
    { x: on.x - (on.x - square.x) * scale, y: on.y - (on.y - square.y) * scale, size: next },
    width,
    height,
  );
}

/** A square rounded to whole pixels, still inside the picture. */
export function wholeSquare(square: Square, width: number, height: number): Square {
  const size = Math.max(1, Math.min(Math.round(square.size), width, height));
  return {
    x: Math.max(0, Math.min(Math.round(square.x), width - size)),
    y: Math.max(0, Math.min(Math.round(square.y), height - size)),
    size,
  };
}
