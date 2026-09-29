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
