// An Instrument the Chord Finder plays on (ADR 0012). The Chord theory knows
// none; each Instrument brings how it voices a Chord, what a shape placed on
// it sounds, and what's kept of a Voicing the user prefers. Look up, Name it,
// Suggest, hearing a Voicing and the preferred Voicings go through it, so
// another Instrument sits beside the guitar without reworking any of them.

import type { Chord } from './chordTheory';

/** One note sounded: its pitch, and how bright it sounds. */
export interface Pluck {
  /** As a MIDI note number. */
  pitch: number;
  /** From dark, near 0, to bright, 1: the guitar's open top string. */
  brightness: number;
}

/**
 * An Instrument: `V` is one of its Voicings, `Shape` what's placed on it to
 * play or name a Chord (a guitar's frets), and `Kept` what's kept on this
 * device of a Voicing the user prefers.
 */
export interface Instrument<V, Shape, Kept> {
  /** Every Voicing of a Chord on it, best first. */
  voicings(chord: Chord): V[];
  /** What a Voicing places on it. */
  shape(voicing: V): Shape;
  /** What a shape placed on it sounds, low note to high: what hearing it plays. */
  plucks(shape: Shape): Pluck[];
  /** Where its preferred Voicings are kept on this device. */
  preferredKey: string;
  /** What's kept of a Voicing when the user prefers it. */
  preference(voicing: V): Kept;
  /** Whether a Voicing is the one a kept preference points at. */
  prefers(voicing: V, kept: Kept): boolean;
  /** Whether a value kept on this device is one of its preferences, not one gone wrong. */
  isPreference(kept: unknown): kept is Kept;
}
