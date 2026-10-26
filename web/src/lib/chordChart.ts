// The Chord Chart: how to play the Chords a Song shows, in Read mode. Which
// Chords it draws, and the tuning it draws them for. The Voicings come from
// the Chord Finder (ADR 0012), drawn as its diagrams are.

import type { Song } from './api';
import { hasChords } from './chords';
import {
  chordName,
  highestKey,
  lookUp,
  lowestKey,
  readTuning,
  standard,
  type FinderContext,
  type InstrumentName,
  type PianoVoicing,
  type Voicing,
} from './chordFinder';
import { activeAlternate, sectionsInArrangement } from './sections';
import { transposeChord } from './transpose';

/**
 * The Chords the Chord Chart draws: those in the Arrangement's active
 * Alternates, Chord Lines included, as Read mode shows them (transposed by
 * semitones, spelled from the Song's key), each once, in the order they first
 * appear. Two names the Chord Finder tidies to the same Chord (CMaj7, Cmaj7)
 * are one, shown as it first appears. A name that can't be read keeps its
 * place, once, as shown.
 */
export function chartChords(song: Song, transpose = 0): string[] {
  const sections = new Map(song.sections.map((s) => [s.id, s]));
  const listed = new Map<string, string>();
  for (const section of sectionsInArrangement(song, sections))
    for (const line of activeAlternate(section)?.lines ?? [])
      for (const chord of line.chords) {
        const shown = transposeChord(chord.name, transpose, song.key);
        const tidied = chordName(shown) ?? shown;
        if (!listed.has(tidied)) listed.set(tidied, shown);
      }
  return [...listed.values()];
}

/**
 * Where a Song has Chords, as Read mode shows it: `shown` in the Arrangement's
 * active Alternates, the ones the Chord Chart draws; `elsewhere`, only in the
 * Scrapbook or an inactive Alternate, so Read mode shows none; or `none`.
 */
export type ChordsInRead = 'shown' | 'elsewhere' | 'none';

export function chordsInRead(song: Song): ChordsInRead {
  if (chartChords(song).length > 0) return 'shown';
  return hasChords(song) ? 'elsewhere' : 'none';
}

/**
 * The tuning the Chord Chart draws for, from the Song's: Standard when it's
 * blank, as the Chord Finder reads it otherwise, or null when it can't be
 * read. Never Standard in place of a tuning that can't be read (ADR 0008).
 */
export function chartTuning(text: string): readonly number[] | null {
  return text.trim() === '' ? standard : readTuning(text);
}

/**
 * What the Chord Chart draws on: the device's Instrument, shared with the
 * Chord Finder. On the guitar, it's in the Song's tuning (from chartTuning),
 * or null when that can't be read. The piano has no tuning, so the Song's
 * doesn't matter on it, even one that can't be read.
 */
export function chartContext(instrument: InstrumentName, tuning: string): FinderContext | null {
  if (instrument === 'piano') return { instrument: 'piano' };
  const read = chartTuning(tuning);
  return read && { instrument: 'guitar', tuning: read };
}

/** A stretch of a piano's keys, as MIDI note numbers, both ends drawn. */
export interface KeyRange {
  lowest: number;
  highest: number;
}

const octave = 12;

/**
 * The keys every piano card in the Chord Chart draws, so they line up: the
 * whole octaves, C to C, just covering every key any of its Voicings
 * presses, each card marking only its own. Never wider than the Chord
 * Finder's C3 to C5, which every piano Voicing fits, and C3 to C5 with none.
 */
export function chartKeyRange(voicings: readonly PianoVoicing[]): KeyRange {
  const pressed = voicings.flatMap((v) => v.keys);
  if (pressed.length === 0) return { lowest: lowestKey, highest: highestKey };
  const lowest = Math.max(lowestKey, Math.floor(Math.min(...pressed) / octave) * octave);
  const highest = Math.min(highestKey, Math.max(lowest + octave, Math.ceil(Math.max(...pressed) / octave) * octave));
  return { lowest, highest };
}

/**
 * What the Chord Chart draws for a Chord as shown: the preferred Voicing of
 * it on the device's Instrument (on the guitar, in the tuning), else the
 * top-ranked one, as the Chord Finder would, and as a Chord's popover opens
 * on. Or why it draws none: the Chord can't be read, it has no Voicing, or
 * the guitar's tuning can't be read (a null context, from chartContext).
 */
export type ChartVoicing =
  | { kind: 'voicing'; voicing: Voicing }
  | { kind: 'unreadable-chord' }
  | { kind: 'no-voicing' }
  | { kind: 'unreadable-tuning' };

export function chartVoicing(name: string, context: FinderContext | null): ChartVoicing {
  const found = chartVoicings(name, context);
  if (found.kind !== 'voicings') return found;
  const voicing = found.voicings[0];
  return voicing ? { kind: 'voicing', voicing } : { kind: 'no-voicing' };
}

/**
 * What a Chord's popover steps through: every Voicing of the Chord as shown
 * on the device's Instrument, the preferred one first, else the top-ranked,
 * as the Chord Finder lists them. With the Chord's name as the Chord Finder
 * reads it, the name preferring one names it by, and whether the first is
 * preferred. Or why there are none to step through: the Chord or the
 * guitar's tuning can't be read.
 */
export type ChartVoicings =
  | { kind: 'voicings'; chord: string; voicings: Voicing[]; preferred: boolean }
  | { kind: 'unreadable-chord' }
  | { kind: 'unreadable-tuning' };

export function chartVoicings(name: string, context: FinderContext | null): ChartVoicings {
  if (!context) return { kind: 'unreadable-tuning' };
  const found = lookUp(name, context);
  if (found.kind !== 'chord') return { kind: 'unreadable-chord' };
  return { kind: 'voicings', chord: found.name, voicings: found.voicings, preferred: found.preferred };
}
