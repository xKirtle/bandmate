// The Chord Finder: a built-in reference for Chords. This module is its one
// seam: the instrument-agnostic Chord theory (chordTheory.ts) and the
// Instruments (instrument.ts), the guitar (guitar.ts, and its tunings in
// guitarTuning.ts) and the piano (piano.ts), sit behind it (ADR 0012) and
// can be reorganised freely. Look up, Name it, Suggest and hearing a Voicing
// go through the Instrument the Finder's context names, never its strings
// and frets or its keys.

import {
  nameNotes,
  oneSpelling,
  readChord,
  readKey,
  spellNotes,
  suggestAfter,
  suggestFromKey,
  type Chord,
  type Suggestion,
} from './chordTheory';
import { guitar, type Frets, type GuitarVoicing } from './guitar';
import {
  guitarTuningName,
  guitarTuningNotes,
  guitarTuningText,
  namedTunings,
  readGuitarTuning,
  standardTuning,
} from './guitarTuning';
import type { Instrument, Pluck } from './instrument';
import { piano, type PianoKeys, type PianoVoicing } from './piano';
import { keys } from './transpose';

export { qualities, roots, type Quality, type Suggestion } from './chordTheory';
/** The one list of Keys (transpose.ts), the list a Song's and a Beat's Key field offers, and what Suggest's Tonics are projected from. */
export { keys };
export type { Frets, GuitarVoicing } from './guitar';
export type { Pluck } from './instrument';
export { pianoKeyName, type PianoKeys, type PianoVoicing } from './piano';

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

/** The Instruments the Chord Finder offers, in the order its Instrument field lists them. */
export const instruments = ['guitar', 'piano'] as const;
export type InstrumentName = (typeof instruments)[number];

/** One way to play a Chord on the Finder's Instrument: on the guitar its frets, on the piano its keys. */
export type Voicing = GuitarVoicing | PianoVoicing;

/** The notes placed on the Finder's Instrument to play or name a Chord: on the guitar frets, on the piano keys. */
export type Placement = Frets | PianoKeys;

/** What's kept on this device of a Voicing the user prefers on the Finder's Instrument: on the guitar its frets, on the piano its inversion. */
export type Preference = Frets | number;

/** What the Chord Finder plays on: its Instrument, the guitar with its tuning, or the piano. */
export type FinderContext = GuitarContext | PianoContext;

/** The Voicings a Finder's context plays: the guitar's or the piano's. */
export type VoicingOn<C extends FinderContext> = C extends PianoContext ? PianoVoicing : GuitarVoicing;

/** Whether a Voicing is the piano's, so it's drawn on a keyboard, not a fretboard. */
export function isPianoVoicing(voicing: Voicing): voicing is PianoVoicing {
  return 'keys' in voicing;
}

/** The Chord Finder on the guitar, in a tuning. */
export interface GuitarContext {
  /**
   * The Instrument: the guitar. Left out, it's the guitar too, as the Chord
   * Chart's context leaves it, since the Chart only draws the guitar.
   */
  instrument?: 'guitar';
  /** The strings' pitches, low to high, as MIDI note numbers. */
  tuning: readonly number[];
  /**
   * The user's preferred Voicing of each Chord on this Instrument, by the
   * Chord's name in the one spelling (see oneSpellingOf), as the Instrument
   * keeps one: on the guitar, its frets low string to high, per tuning.
   */
  preferred?: Readonly<Record<string, Frets>>;
}

/** The Chord Finder on the piano, which has no tuning. */
export interface PianoContext {
  instrument: 'piano';
  /** The user's preferred Voicing of each Chord on the piano, by the Chord's name in the one spelling, as its inversion. */
  preferred?: Readonly<Record<string, number>>;
}

/** The Instrument a Finder's context plays on. */
export function finderInstrument(context: GuitarContext): Instrument<GuitarVoicing, Frets, Frets>;
export function finderInstrument(context: PianoContext): Instrument<PianoVoicing, PianoKeys, number>;
export function finderInstrument(context: FinderContext): Instrument<Voicing, Placement, Preference>;
export function finderInstrument(context: FinderContext): Instrument<Voicing, Placement, Preference> {
  return context.instrument === 'piano' ? piano() : guitar(context.tuning);
}

export type LookUp<V = Voicing> =
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
      voicings: V[];
      /** Whether the first Voicing is the user's preferred one, not just the best-ranked. */
      preferred: boolean;
    }
  | { kind: 'unreadable'; name: string };

/**
 * Looks up a Chord name: its notes and every Voicing of it, best first, or
 * that it can't be read. The user's preferred Voicing of it comes first, if
 * it's still one of its Voicings.
 */
export function lookUp<C extends FinderContext>(name: string, context: C): LookUp<VoicingOn<C>> {
  const chord = readChord(name);
  if (!chord) return { kind: 'unreadable', name };
  const instrument = finderInstrument(context as FinderContext) as Instrument<VoicingOn<C>, unknown, unknown>;
  const { voicings, preferredAt } = ranked(chord, instrument, context.preferred);
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

/**
 * The Voicing Look up shows first for a Chord name, and Suggest draws for a
 * Chord it suggests: the user's preferred one on the Instrument (on the
 * guitar, in the tuning), else the best-ranked. Null when it has none (on
 * the guitar, up to the 12th fret), or can't be read.
 */
export function firstVoicing<C extends FinderContext>(name: string, context: C): VoicingOn<C> | null {
  const found = lookUp(name, context);
  return found.kind === 'chord' ? (found.voicings[0] ?? null) : null;
}

/** A Chord name, tidied as Look up reads it (CMaj7 reads as Cmaj7, F♯- as F#m), or null if it can't be read. */
export function chordName(text: string): string | null {
  return readChord(text)?.name ?? null;
}

/**
 * A Chord name in the one spelling: one name for every spelling of a Chord,
 * since Dbmaj7 and C#maj7 are one sound with one set of Voicings. What's
 * kept per Chord on this device is kept by it. Null if it can't be read.
 */
export function oneSpellingOf(text: string): string | null {
  const chord = readChord(text);
  return chord && oneSpelling(chord);
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
 * Names the notes placed on the Finder's Instrument: every reading of them,
 * best first, and the notes sounding. Readings with the root as the lowest
 * note come first, then the simpler names.
 */
export function nameIt(placement: Placement, context: FinderContext): NameIt {
  const sounding = plucks(placement, context).map((p) => p.pitch % 12);
  const chords = nameNotes(sounding);
  const notes = spellNotes(sounding, chords[0] ?? null);
  return chords.length ? { kind: 'chord', readings: chords.map((c) => c.name), notes } : { kind: 'none', notes };
}

/**
 * What hearing the notes placed on the Finder's Instrument plays, low to
 * high: each note's pitch, and how bright it sounds. On the guitar, its
 * strings in the tuning, muted strings skipped, each as bright as the string
 * and fret it's played on: what a strum plays. On the piano, its keys,
 * which Hear sounds together.
 */
export function plucks(placement: Placement, context: FinderContext): Pluck[] {
  return finderInstrument(context).plucks(placement);
}

/** Whether Hear strums a Voicing on the Finder's Instrument, as on the guitar, or sounds its notes together, as on the piano. */
export function strummed(context: FinderContext): boolean {
  return finderInstrument(context).strummed;
}

/** What hearing a Voicing on the Finder's Instrument plays: the notes it places, as plucks plays them. */
export function voicingPlucks(voicing: Voicing, context: FinderContext): Pluck[] {
  return plucks(finderInstrument(context).placement(voicing), context);
}

/**
 * A Chord's Voicings on an Instrument, best first: the preferred one, if
 * it's still one of them, then the rest as the Instrument ranks them. With
 * where the preferred one was, -1 for none.
 */
function ranked<V, K>(
  chord: Chord,
  instrument: Instrument<V, unknown, K>,
  preferred: Readonly<Record<string, K>> | undefined,
): { voicings: V[]; preferredAt: number } {
  const voicings = instrument.voicings(chord);
  const kept = preferred?.[oneSpelling(chord)];
  const preferredAt = kept === undefined ? -1 : voicings.findIndex((v) => instrument.prefers(v, kept));
  if (preferredAt > 0) voicings.unshift(...voicings.splice(preferredAt, 1));
  return { voicings, preferredAt };
}

/** A Key's name, tidied (G major, E minor), read as Transpose reads the Song's Key, or null if it can't be read. */
export function keyName(text: string): string | null {
  return readKey(text)?.name ?? null;
}

/** A Key split into the Tonic and the quality Suggest's pickers hold. */
export interface KeyParts {
  /** The Tonic as this Key's own signature spells it: Eb in Eb major, D# in D# minor. */
  tonic: string;
  /** Whether the quality is minor: a Key is a Tonic with major or minor on it. */
  minor: boolean;
}

/**
 * The twelve Tonics a Key of this Quality can have, each spelled from its
 * own signature: C C# D Eb E F F# G Ab A Bb B major, and C C# D D# E F F# G
 * G# A A# B minor. It's the shared list of 24 (keys) projected by Quality,
 * not a list of its own, so the two can never drift apart. Three of the
 * twelve change with the Quality, which is why Suggest never shows a
 * Tonic's two spellings at once, and why no Tonic here is a Key that
 * doesn't exist: there is no D# major, so the major list never offers one.
 */
export function tonics(minor: boolean): readonly string[] {
  return keys.filter((key) => key.endsWith('m') === minor).map((key) => (minor ? key.slice(0, -1) : key));
}

/** A Key split into the Tonic and quality the pickers hold, or null if it can't be read. */
export function splitKey(text: string): KeyParts | null {
  const read = readKey(text);
  return read && { tonic: read.signature[read.tonic], minor: read.minor };
}

/** The Key a Tonic and a quality name, as the pickers write it (G, Em). */
export function joinKey({ tonic, minor }: KeyParts): string {
  return tonic + (minor ? 'm' : '');
}

/**
 * A Key as the pickers write it (G, Em), spelled from its own signature, or
 * null if it can't be read: Db is C#, and Ebm is D#m. It's to a Key what
 * tuningText is to a tuning, the one spelling the app writes.
 */
export function keyText(text: string): string | null {
  const parts = splitKey(text);
  return parts && joinKey(parts);
}

/**
 * The same pitch in the other quality, re-spelled for it: Eb major becomes
 * D# minor, never Eb minor. The pitch is what's kept; the spelling follows
 * the signature of the quality it lands in.
 */
export function otherQuality({ tonic, minor }: KeyParts): KeyParts {
  const at = tonics(minor).indexOf(tonic);
  return { tonic: at < 0 ? tonic : tonics(!minor)[at], minor: !minor };
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
