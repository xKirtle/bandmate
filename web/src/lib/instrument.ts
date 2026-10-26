// An Instrument the Chord Finder plays on (ADR 0012). The Chord theory knows
// none; each Instrument brings how it voices a Chord, what the notes placed
// on it sound, and what's kept of a Voicing the user prefers. Look up, Name
// it, Suggest, hearing a Voicing and the preferred Voicings go through it,
// so another Instrument sits beside the guitar without reworking any of them.

import type { Chord } from './chordTheory';
import type { SampleSet } from './samples';

/** How an Instrument sounds when a Voicing on it is heard. Not a Song's Sound, an audio file. */
export interface InstrumentSound {
  /**
   * The recorded samples it plays (ADR 0030), or the guitar's synthesised
   * pluck, which it plays until it has samples of its own.
   */
  samples: SampleSet | 'pluck';
  /** Whether Hear strums its notes, low to high, as a guitar's strings are, rather than sounding them together, as a piano's keys are. */
  strummed: boolean;
}

/** One note heard: which note, and, on the guitar, how bright it sounds. */
export interface HeardNote {
  /** Its MIDI note number. */
  midi: number;
  /** From dark, near 0, to bright, 1: the guitar's open top string. Only the guitar's pluck reads it; samples sound as recorded. */
  brightness?: number;
}

/**
 * An Instrument: `Voicing` is one of its Voicings, `Placement` the notes
 * placed on it to play or name a Chord (a guitar's frets), and `Preference`
 * what's kept on this device of a Voicing the user prefers.
 */
export interface Instrument<Voicing, Placement, Preference> {
  /** Every Voicing of a Chord on it, best first. */
  voicings(chord: Chord): Voicing[];
  /** The notes a Voicing places on it. */
  placement(voicing: Voicing): Placement;
  /** What the notes placed on it sound, low to high: what hearing them plays. */
  heardNotes(placement: Placement): HeardNote[];
  /** How it sounds. Hear strums a plucked sound's notes, low to high, as a guitar's strings are, and sounds a struck one's together, as a piano's keys are. */
  sound: InstrumentSound;
  /** Where its preferred Voicings are kept on this device. */
  preferredStorageKey: string;
  /** What's kept of a Voicing when the user prefers it. */
  preference(voicing: Voicing): Preference;
  /** Whether a Voicing is the one a kept preference points at. */
  prefers(voicing: Voicing, preference: Preference): boolean;
  /** Whether a value kept on this device is one of its preferences, not one gone wrong. */
  isPreference(kept: unknown): kept is Preference;
}
