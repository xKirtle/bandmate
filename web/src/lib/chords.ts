import type { Line, Song } from './api';
import { transposeChord } from './transpose';

/** A run of lyrics with the Chords (if any) that sit above its first character, in order. */
export interface Piece {
  chords: string[];
  text: string;
  /**
   * The Chords fall between words, and what comes straight after isn't a
   * Chord, so they need no room past their names: the gap is the whitespace
   * as typed, or the names if they're wider.
   */
  snug?: true;
}

/**
 * Lays out a parsed Line for showing Chords above lyrics. Each group of
 * Pieces is one word with its trailing spaces: it never wraps inside, so a
 * mid-word Chord stays over its word on narrow screens. A Chord anchored on a
 * space falls between words, so its Piece is all the whitespace it falls in,
 * from the word or Chord before it to the word or Chord after. The Chords show
 * transposed by semitones, as written by default, spelled from the Song's key.
 */
export function layoutLine(line: Line, transpose = 0, key = ''): Piece[][] {
  // Offsets count code points, which Array.from splits on.
  const chars = Array.from(line.lyrics);
  const space = (i: number) => i >= 0 && i < chars.length && /\s/.test(chars[i]);
  const chordsAt = new Map<number, string[]>();
  for (const c of line.chords)
    chordsAt.set(c.offset, [...(chordsAt.get(c.offset) ?? []), transposeChord(c.name, transpose, key)]);

  // Where each Chord's Piece starts, and whether it falls between words. A
  // Chord Line's Chords sit on spaces too, but it has no words to fall
  // between, so its Chords stay as they are.
  const startsAt = new Map<number, { chords: string[]; between: boolean }>();
  for (const [offset, chords] of chordsAt) {
    const between = !line.chordLine && space(offset);
    let start = offset;
    if (between) while (space(start - 1) && !chordsAt.has(start - 1)) start--;
    startsAt.set(start, { chords, between });
  }

  const words: Piece[][] = [];
  const between = new Set<Piece>();
  let word: Piece[] | null = null;
  for (let i = 0; i <= chars.length; i++) {
    const starts = startsAt.get(i);
    // The whitespace a Chord falls between is a word of its own, so the line
    // can still wrap before it.
    if (starts?.between) word = null;
    if (starts || (!word && i < chars.length)) {
      if (!word) words.push((word = []));
      const piece = { chords: starts?.chords ?? [], text: '' };
      if (starts?.between) between.add(piece);
      word.push(piece);
    }
    if (i === chars.length) break;
    const piece = word![word!.length - 1];
    piece.text += chars[i];
    // A space ends the word, so the line can wrap after it, unless it's in
    // whitespace a Chord falls between that goes on.
    const goesOn = between.has(piece) && space(i + 1) && !startsAt.has(i + 1);
    if (space(i) && !goesOn) word = null;
  }

  // A Chord straight after keeps the usual separation, so names never touch.
  const pieces = words.flat();
  pieces.forEach((piece, n) => {
    if (between.has(piece) && !pieces[n + 1]?.chords.length) piece.snug = true;
  });
  return words;
}

/** Whether any of the Song's Lines has a Chord. */
export function hasChords(song: Song): boolean {
  return song.sections.some((s) => s.alternates.some((a) => a.lines.some((l) => l.chords.length > 0)));
}
