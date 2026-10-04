// The Chord Finder: a built-in reference for Chords. This module is its one
// seam: the instrument-agnostic Chord theory (chordTheory.ts) and the guitar
// Instrument (guitar.ts) sit behind it (ADR 0012) and can be reorganised
// freely.

import { readChord } from './chordTheory';
import { guitarVoicings, type Voicing } from './guitar';

export { qualities, roots, type Quality } from './chordTheory';
export type { Voicing } from './guitar';

/** Standard tuning, its strings' pitches low to high, as MIDI note numbers (E2 A2 D3 G3 B3 E4). */
export const standard: readonly number[] = [40, 45, 50, 55, 59, 64];

/** What the Chord Finder plays on: a tuning and a capo for the guitar. */
export interface FinderContext {
  /** The strings' pitches, low to high, as MIDI note numbers. */
  tuning: readonly number[];
  /** The fret the capo is on, 0 for none. Frets are counted from it. */
  capo: number;
}

export type LookUp =
  | {
      kind: 'chord';
      /** The name as read, tidied: CMaj7 reads as Cmaj7, F♯- as F#m. */
      name: string;
      /** Its root, quality (as a quality's suffix) and slash bass, as the pickers write them. */
      root: string;
      quality: string;
      bass: string | null;
      notes: string[];
      voicings: Voicing[];
    }
  | { kind: 'unreadable'; name: string };

/**
 * Looks up a Chord name: its notes and every Voicing of it, best first, or
 * that it can't be read.
 */
export function lookUp(name: string, context: FinderContext): LookUp {
  const chord = readChord(name);
  if (!chord) return { kind: 'unreadable', name };
  return {
    kind: 'chord',
    name: chord.name,
    root: chord.rootName,
    quality: chord.quality.suffix,
    bass: chord.bassName,
    notes: chord.notes,
    voicings: guitarVoicings(chord, context),
  };
}
