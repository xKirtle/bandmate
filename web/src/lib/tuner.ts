// The Tuner (see the glossary): tuning a guitar to the device's Tuning. This
// module is what it knows of the Tuning's strings: each one's note, in the
// octave the Tuning gives it, and what tapping it plays, from the guitar's
// recorded samples (ADR 0030), always at A = 440 Hz. The Tuner is a guitar's
// whatever the device's Instrument, so it plays the guitar however that's set.

import { commonNote } from './chordTheory';
import { guitar, stringNumber } from './guitar';
import { guitarTuningStrings, standardTuning } from './guitarTuning';
import type { HeardNote, InstrumentSound } from './instrument';

/** One of the Tuning's strings, as the Tuner shows and plays it. */
export interface TunerString {
  /** Its note and octave, as written in the Tuning: E2, G#3, Eb4. */
  name: string;
  /** Its number, as players count them from the high string: the low string is the 6th. */
  number: string;
  /** What tapping it plays: its note, on that string. */
  heard: HeardNote;
}

/** How the Tuner sounds: the guitar's, ringing once a tap. */
export const tunerSound: InstrumentSound = guitar(standardTuning).sound;

/**
 * The Tuning's six strings, low to high, each in the octave nearest that
 * string in standard tuning, the lower one when two are as near. Null for a
 * Tuning that can't be read, which can't be tuned to rather than a guess.
 */
export function tunerStrings(tuning: string): TunerString[] | null {
  return (
    guitarTuningStrings(tuning)?.map(({ note, pitch }, string) => ({
      name: note + octave(note, pitch),
      number: stringNumber(string, 6),
      heard: { midi: pitch, string },
    })) ?? null
  );
}

/** Where a string's peg is on the Tuner's headstock. */
export interface TunerPeg {
  /** The side of the headstock, as it's looked at. */
  side: 'left' | 'right';
  /** Its place down that side, 1 at the top, furthest from the nut, and 3 nearest it. */
  row: 1 | 2 | 3;
}

/**
 * Where the peg of a string is, by its place low to high (0 is the low
 * string), on a 3+3 headstock: the three low strings down the left, the three
 * high ones down the right, each outer string on the peg nearest the nut, at
 * the foot, so no string crosses another on its way from the nut. Mirrored for a left-handed player,
 * the low strings on the right, as a left-handed guitar's are.
 */
export function tunerPeg(string: number, leftHanded: boolean): TunerPeg {
  const low = string < 3;
  return {
    side: low !== leftHanded ? 'left' : 'right',
    row: (low ? 3 - string : string - 2) as TunerPeg['row'],
  };
}

/** How far either way of a string's note it's in tune, in cents: under 5. */
export const inTuneWithin = 5;

/** What the Tuner reads from a note it hears. */
export interface TunerReading {
  /** The note heard, the nearest to its pitch, with its octave: as the Tuning writes it where it's the string's, else C# or Eb. */
  heard: string;
  /** The string whose note is nearest. */
  string: TunerString;
  /** How far sharp of that string's note it is, in cents: flat below 0. */
  cents: number;
  /** Whether it's in tune: within 5 cents of the string's note, either way. */
  inTune: boolean;
}

/** How many cents sharp of a MIDI note a frequency is, at A = 440 Hz. */
function centsFrom(frequency: number, midi: number): number {
  return 1200 * Math.log2(frequency / 440) - 100 * (midi - 69);
}

/**
 * What the Tuner reads from a frequency heard, in Hz, tuned to a Tuning's
 * strings: the string whose note is nearest by pitch, the lower where two
 * are as near, and how far sharp or flat of it the note is.
 */
export function tunerReading(frequency: number, strings: readonly TunerString[]): TunerReading {
  // The lower string wins a tie, however the arithmetic rounds it.
  const nearer = (a: TunerString, b: TunerString) =>
    Math.abs(centsFrom(frequency, b.heard.midi)) < Math.abs(centsFrom(frequency, a.heard.midi)) - 1e-6 ? b : a;
  const string = strings.reduce(nearer);
  const cents = centsFrom(frequency, string.heard.midi);
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const named = strings.find((s) => s.heard.midi === midi);
  const common = commonNote(midi);
  const heard = named ? named.name : common + octave(common, midi);
  return { heard, string, cents, inTune: Math.abs(cents) < inTuneWithin };
}

/** How far off a string is, in cents, for its wave to drift a wavelength a second. */
const centsPerWave = 25;
/** How far off it drifts fastest at, in cents: past it, the wave drifts no faster. */
const fastestFrom = 50;

/**
 * How fast the Tuner's wave drifts, as a strobe tuner's does, in wavelengths
 * a second: flat drifts back (below 0), sharp forward, faster the further
 * off, up to two a second from 50 cents, and it stands still in tune or with
 * nothing heard.
 */
export function tunerDrift(reading: TunerReading | null): number {
  if (!reading || reading.inTune) return 0;
  return Math.max(-fastestFrom, Math.min(fastestFrom, reading.cents)) / centsPerWave;
}

/**
 * The octave a note is written in: its letter's, so C♭ sounding as B3 is C♭4,
 * and B♯ sounding as C4 is B♯3. Middle C (60) starts octave 4.
 */
function octave(note: string, pitch: number): number {
  const accidentals = [...note].reduce((sum, c) => sum + (c === '#' ? 1 : c === 'b' ? -1 : 0), 0);
  return Math.floor((pitch - accidentals) / 12) - 1;
}
