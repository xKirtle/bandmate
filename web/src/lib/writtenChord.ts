// A Chord as it's written in a Line's text, between brackets: its name, and
// after a colon its Song Voicing, if it has one ("Em:00002x"). Read as the
// server reads it (internal/song/chords.go), so Write mode and the server
// agree on what's a Chord.

import type { Frets } from './guitar';

const note = '[A-G][#b♯♭]?';
const token = '(?:maj|min|ma|mi|dim|aug|sus|add|alt|m|M|\\+|-|°|ø|Δ|6/9|[#b♯♭]?[0-9]+)';
const chordName = new RegExp(`^${note}(?:${token}|\\((?:${token}|,)+\\))*(?:/${note})?$`, 'u');

// Each string's fret, low string to high, x for a muted one: one character a
// fret, every fret 9 or lower, or parted by dashes, any fret up to 99.
const fret = '(?:x|0|[1-9][0-9]?)';
const songVoicing = new RegExp(`^(?:[0-9x]+|${fret}(?:-${fret})+)$`);

/** A Chord as written: its name, and its Song Voicing's frets, or null when it's written without one. */
export interface WrittenChord {
  name: string;
  songVoicing: Frets | null;
}

/**
 * Each Chord in a Line's text as it's typed between its brackets
 * ("Em:00002x"), in order, found as the server finds them: from each "[",
 * up to the next "]", and when that isn't a Chord, on from the next
 * character. So they're the Line's Chords, one for one.
 */
export function writtenChords(text: string): string[] {
  const found: string[] = [];
  for (let at = text.indexOf('['); at >= 0; at = text.indexOf('[', at + 1)) {
    const end = text.indexOf(']', at + 1);
    if (end < 0) break;
    const written = text.slice(at + 1, end);
    if (!readWrittenChord(written)) continue;
    found.push(written);
    at = end;
  }
  return found;
}

/** The Chord written between a pair of brackets, or null when its name or its frets can't be read, so it stays in the lyrics. */
export function readWrittenChord(text: string): WrittenChord | null {
  const colon = text.indexOf(':');
  const name = colon < 0 ? text : text.slice(0, colon);
  if (!chordName.test(name)) return null;
  if (colon < 0) return { name, songVoicing: null };
  const frets = text.slice(colon + 1);
  if (!songVoicing.test(frets)) return null;
  const written = frets.includes('-') ? frets.split('-') : Array.from(frets);
  return { name, songVoicing: written.map((f) => (f === 'x' ? null : Number(f))) };
}

/**
 * A Chord written with a Song Voicing, brackets and all, ready to paste into
 * a Line: its name, a colon and its frets low string to high, parted by
 * dashes, x for a muted string ("[Em:x-0-9-9-x-x]"). Dashes read whatever
 * the frets are.
 */
export function bracketedChordWithSongVoicing(name: string, frets: Frets): string {
  return `[${name}:${frets.map((f) => f ?? 'x').join('-')}]`;
}
