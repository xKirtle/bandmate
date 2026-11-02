// The Tuner (see the glossary): tuning a guitar to the device's Tuning. This
// module is what it knows of the Tuning's strings: each one's note, in the
// octave the Tuning gives it, and what tapping it plays, from the guitar's
// recorded samples (ADR 0030), always at A = 440 Hz. The Tuner is a guitar's
// whatever the device's Instrument, so it plays the guitar however that's set.

import { guitar } from './guitar';
import { guitarTuningStrings, standardTuning } from './guitarTuning';
import type { HeardNote, InstrumentSound } from './instrument';

/** One of the Tuning's strings, as the Tuner shows and plays it. */
export interface TunerString {
  /** Its note and octave, as written in the Tuning: E2, G#3, Eb4. */
  name: string;
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
      heard: { midi: pitch, string },
    })) ?? null
  );
}

/**
 * The octave a note is written in: its letter's, so C♭ sounding as B3 is C♭4,
 * and B♯ sounding as C4 is B♯3. Middle C (60) starts octave 4.
 */
function octave(note: string, pitch: number): number {
  const accidentals = [...note].reduce((sum, c) => sum + (c === '#' ? 1 : c === 'b' ? -1 : 0), 0);
  return Math.floor((pitch - accidentals) / 12) - 1;
}
