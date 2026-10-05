// The Chord Finder: a built-in reference for Chords. This module is its one
// seam: the instrument-agnostic Chord theory (chordTheory.ts) and the guitar
// Instrument (guitar.ts, and its tunings in guitarTuning.ts) sit behind it
// (ADR 0012) and can be reorganised freely.

import {
  nameNotes,
  readChord,
  readKey,
  spellNotes,
  suggestAfter,
  suggestFromKey,
  type Suggestion,
} from './chordTheory';
import { guitarNotes, guitarVoicings, type Voicing } from './guitar';
import {
  guitarTuningName,
  guitarTuningNotes,
  guitarTuningText,
  namedTunings,
  readGuitarTuning,
  standardTuning,
} from './guitarTuning';

export { qualities, roots, type Quality, type Suggestion } from './chordTheory';
export type { Voicing } from './guitar';

/** Standard tuning, its strings' pitches low to high, as MIDI note numbers (E2 A2 D3 G3 B3 E4). */
export const standard: readonly number[] = standardTuning;

/** A tuning's text, as a Song's Details hold it, as its strings' pitches low to high, or null if it can't be read. */
export function readTuning(text: string): number[] | null {
  return readGuitarTuning(text);
}

/** The named tunings, in the order a picker lists them. */
export const tunings: readonly string[] = namedTunings.map((t) => t.name);

/** The named tuning a tuning's text reads as, by name, alias or notes, or null if it's another or can't be read. */
export function tuningName(text: string): string | null {
  return guitarTuningName(text);
}

/**
 * A tuning's text as a Song's Details write it: its name if it's a named
 * tuning, else its six notes, spaced. Null if it can't be read.
 */
export function tuningText(text: string): string | null {
  return guitarTuningText(text);
}

/** A tuning's six notes, low string to high, spaced, even for a named tuning. Null if it can't be read. */
export function tuningNotes(text: string): string | null {
  return guitarTuningNotes(text);
}

/** A Voicing's frets, low string to high: 0 for open, null for muted. */
export type Frets = readonly (number | null)[];

/** What the Chord Finder plays on: a tuning for the guitar. */
export interface FinderContext {
  /** The strings' pitches, low to high, as MIDI note numbers. */
  tuning: readonly number[];
  /**
   * The user's preferred Voicing of each Chord in this tuning, by the Chord's
   * name as read (see LookUp's name), as its frets low string to high.
   */
  preferred?: Readonly<Record<string, Frets>>;
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
      /** Every Voicing, best first: the preferred one, then the rest as ranked. */
      voicings: Voicing[];
      /** Whether the first Voicing is the user's preferred one, not just the best-ranked. */
      preferred: boolean;
    }
  | { kind: 'unreadable'; name: string };

/**
 * Looks up a Chord name: its notes and every Voicing of it, best first, or
 * that it can't be read. The user's preferred Voicing of it comes first, if
 * it's still one of its Voicings.
 */
export function lookUp(name: string, context: FinderContext): LookUp {
  const chord = readChord(name);
  if (!chord) return { kind: 'unreadable', name };
  const voicings = guitarVoicings(chord, context.tuning);
  const preferredFrets = context.preferred?.[chord.name];
  const preferredAt = preferredFrets ? voicings.findIndex((v) => sameFrets(v.frets, preferredFrets)) : -1;
  if (preferredAt > 0) voicings.unshift(...voicings.splice(preferredAt, 1));
  return {
    kind: 'chord',
    name: chord.name,
    root: chord.rootName,
    quality: chord.quality.suffix,
    bass: chord.bassName,
    notes: chord.notes,
    voicings,
    preferred: preferredAt >= 0,
  };
}

/** A Chord name, tidied as Look up reads it (CMaj7 reads as Cmaj7, F♯- as F#m), or null if it can't be read. */
export function chordName(text: string): string | null {
  return readChord(text)?.name ?? null;
}

export type NameIt =
  | {
      kind: 'chord';
      /** Every Chord name the shape reads as, best first, each one Look up reads. */
      readings: string[];
      /** The notes sounding, low string to high, each once, spelled as the best reading spells them. */
      notes: string[];
    }
  | {
      /** No Chord in the known set fits, or fewer than two different notes sound. */
      kind: 'none';
      notes: string[];
    };

/**
 * Names a shape placed on the guitar: every reading of it, best first, and
 * the notes sounding. Readings with the root as the lowest note come first,
 * then the simpler names.
 */
export function nameIt(frets: Frets, context: FinderContext): NameIt {
  const sounding = guitarNotes(frets, context.tuning);
  const chords = nameNotes(sounding);
  const notes = spellNotes(sounding, chords[0] ?? null);
  return chords.length ? { kind: 'chord', readings: chords.map((c) => c.name), notes } : { kind: 'none', notes };
}

function sameFrets(a: Frets, b: Frets): boolean {
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

/** The Keys Suggest's picker offers, each spelled from its own signature: the twelve major Keys, then the twelve minor. */
export const keys: readonly string[] = [
  ...['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  ...['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'],
];

/** A Key's name, tidied (G major, E minor), read as Transpose reads the Song's Key, or null if it can't be read. */
export function keyName(text: string): string | null {
  return readKey(text)?.name ?? null;
}

export type Suggest =
  | {
      kind: 'key';
      /** The Key's name, tidied: G major, E minor. */
      key: string;
      /** Its own Chords, then those a major Key borrows from its parallel minor, then the secondary dominants. */
      chords: Suggestion[];
      /** The Chords that usually follow the Chord picked, best first, or null with none picked or one that can't be read. */
      follows: Suggestion[] | null;
    }
  | { kind: 'unreadable'; key: string };

/**
 * Suggests Chords from a Key, read as Transpose reads the Song's Key: its
 * Chords with their Roman numerals and why each fits, spelled from the Key's
 * signature, and, after a Chord, the Chords that usually follow it.
 */
export function suggest(key: string, after?: string | null): Suggest {
  const read = readKey(key);
  if (!read) return { kind: 'unreadable', key };
  const picked = after ? readChord(after) : null;
  return {
    kind: 'key',
    key: read.name,
    chords: suggestFromKey(read),
    follows: picked && suggestAfter(read, picked),
  };
}
