import type { Chord, Line, Song } from './api';
import type { Frets } from './guitar';
import { transposeChord } from './transpose';
import { writtenChords } from './writtenChord';

/**
 * A Chord as Read mode shows it: its name, transposed, and the Song Voicing
 * it's played with, if it's written with one and isn't transposed. Moved to
 * another key, a Song Voicing falls away.
 */
export interface ShownChord {
  name: string;
  songVoicing: Frets | null;
}

/** A Chord as shown when transposed by semitones, spelled from the Song's key. */
export function shownChord(chord: Chord, transpose = 0, key = ''): ShownChord {
  const songVoicing = transpose === 0 && chord.songVoicing ? chord.songVoicing : null;
  return { name: transposeChord(chord.name, transpose, key), songVoicing };
}

/**
 * A Chord as shown, as a key: the same for two Chords of the same name played
 * the same way, its Song Voicing written with dashes, as it always can be
 * ("Em:x-0-9-9-x-x"), or none ("Em:").
 */
export function chordKey({ name, songVoicing }: ShownChord): string {
  return `${name}:${songVoicing?.map((f) => f ?? 'x').join('-') ?? ''}`;
}

/** How a Line's Chords are named: as Read mode shows them, or as written, typed between their brackets. */
export type ChordNames = 'as-shown' | 'as-written';

/** A run of lyrics with the Chords (if any) that sit above its first character, in order. */
export interface Piece {
  chords: ShownChord[];
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
 * Shown as written, as Write mode prints them, each Chord is named as it's
 * typed between its brackets, its Song Voicing's frets and all
 * ("Em:00002x").
 */
export function layoutLine(line: Line, transpose = 0, key = '', names: ChordNames = 'as-shown'): Piece[][] {
  // Offsets count code points, which Array.from splits on.
  const chars = Array.from(line.lyrics);
  const isSpace = (i: number) => i >= 0 && i < chars.length && /\s/.test(chars[i]);
  const chordsAt = new Map<number, ShownChord[]>();
  const typed = names === 'as-written' ? writtenChords(line.text) : [];
  line.chords.forEach((c, i) => {
    const shown = shownChord(c, transpose, key);
    const named = typed[i] === undefined ? shown : { ...shown, name: typed[i] };
    chordsAt.set(c.offset, [...(chordsAt.get(c.offset) ?? []), named]);
  });

  // The Chords whose Piece starts at each character, and whether they fall
  // between words. A Chord Line's Chords sit on spaces too, but it has no
  // words to fall between, so its Chords stay as they are.
  const chordPieceAt = new Map<number, { chords: ShownChord[]; isBetween: boolean }>();
  for (const [offset, chords] of chordsAt) {
    const isBetween = !line.chordLine && isSpace(offset);
    let start = offset;
    if (isBetween) while (isSpace(start - 1) && !chordsAt.has(start - 1)) start--;
    chordPieceAt.set(start, { chords, isBetween });
  }

  const words: Piece[][] = [];
  const betweenPieces = new Set<Piece>();
  let word: Piece[] | null = null;
  for (let i = 0; i <= chars.length; i++) {
    const chordPiece = chordPieceAt.get(i);
    // The whitespace a Chord falls between is a word of its own, so the line
    // can still wrap before it.
    if (chordPiece?.isBetween) word = null;
    if (chordPiece || (!word && i < chars.length)) {
      if (!word) words.push((word = []));
      const piece = { chords: chordPiece?.chords ?? [], text: '' };
      if (chordPiece?.isBetween) betweenPieces.add(piece);
      word.push(piece);
    }
    if (i === chars.length) break;
    const piece = word![word!.length - 1];
    piece.text += chars[i];
    // A space ends the word, so the line can wrap after it, unless the
    // whitespace a Chord falls between goes on. (Where another Chord falls
    // in it, that Chord starts a word of its own anyway.)
    if (isSpace(i) && !(betweenPieces.has(piece) && isSpace(i + 1))) word = null;
  }

  // A Chord straight after keeps the usual separation, so names never touch.
  const pieces = words.flat();
  pieces.forEach((piece, n) => {
    if (betweenPieces.has(piece) && !pieces[n + 1]?.chords.length) piece.snug = true;
  });
  return words;
}

/** Whether any of the Song's Lines has a Chord. */
export function hasChords(song: Song): boolean {
  return song.sections.some((s) => s.alternates.some((a) => a.lines.some((l) => l.chords.length > 0)));
}
