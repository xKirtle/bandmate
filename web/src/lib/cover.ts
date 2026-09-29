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
