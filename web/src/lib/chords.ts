import type { Line, Song } from './api';
import { transposeChord } from './transpose';

/** A run of lyrics with the Chords (if any) that sit above its first character. */
export interface Piece {
  chord: string;
  text: string;
}

/**
 * Lays out a parsed Line for showing Chords above lyrics. Each group of
 * Pieces is one word with its trailing spaces: it never wraps inside, so a
 * mid-word Chord stays over its word on narrow screens. The Chords show
 * transposed by semitones, as written by default, spelled from the Song's key.
 */
export function layoutLine(line: Line, transpose = 0, key = ''): Piece[][] {
  // Offsets count code points, which Array.from splits on.
  const chars = Array.from(line.lyrics);
  const chordsAt = new Map<number, string[]>();
  for (const c of line.chords)
    chordsAt.set(c.offset, [...(chordsAt.get(c.offset) ?? []), transposeChord(c.name, transpose, key)]);

  const words: Piece[][] = [];
  let word: Piece[] | null = null;
  for (let i = 0; i <= chars.length; i++) {
    const names = chordsAt.get(i);
    if (names || (!word && i < chars.length)) {
      if (!word) words.push((word = []));
      word.push({ chord: names?.join(' ') ?? '', text: '' });
    }
    if (i === chars.length) break;
    word![word!.length - 1].text += chars[i];
    // A space ends the word, so the line can wrap after it.
    if (/\s/.test(chars[i])) word = null;
  }
  return words;
}

/** Whether any of the Song's Lines has a Chord. */
export function hasChords(song: Song): boolean {
  return song.sections.some((s) => s.alternates.some((a) => a.lines.some((l) => l.chords.length > 0)));
}
