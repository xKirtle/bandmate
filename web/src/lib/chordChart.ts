// The Chord Chart: how to play the Chords a Song shows, in Read mode. Which
// Chords it draws, and the tuning it draws them for. The Voicings come from
// the Chord Finder (ADR 0012), drawn as its diagrams are.

import type { Song } from './api';
import { chordKey, hasChords, shownChord, type ShownChord } from './chords';
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
import { writtenVoicing } from './guitar';
import { activeAlternate, sectionsInArrangement } from './sections';

/**
 * The Chords the Chord Chart draws: those in the Arrangement's active
 * Alternates, Chord Lines included, as Read mode shows them (transposed by
 * semitones, spelled from the Song's key), each way a name is played once, in
 * the order they first appear. Two names the Chord Finder tidies to the same
 * Chord (CMaj7, Cmaj7) are one, shown as it first appears. A name that can't
 * be read keeps its place, once, as shown. On the guitar, untransposed, a
 * Chord with a Song Voicing is played its own way, so it's listed apart from
 * the same name without one or with another; transposed, or on the piano, a
 * Song Voicing falls away, so the Chord is one with any other of its name.
 */
export function chartChords(song: Song, transpose = 0, instrument: InstrumentName = 'guitar'): ShownChord[] {
  const sections = new Map(song.sections.map((s) => [s.id, s]));
  const listed = new Map<string, ShownChord>();
  for (const section of sectionsInArrangement(song, sections))
    for (const line of activeAlternate(section)?.lines ?? [])
      for (const chord of line.chords) {
        const shown = playedOn(shownChord(chord, transpose, song.key), instrument);
        const way = chordKey({ ...shown, name: chordName(shown.name) ?? shown.name });
        if (!listed.has(way)) listed.set(way, shown);
      }
  return [...listed.values()];
}

/** A Chord as shown, as it's played on an Instrument: on the piano, without its Song Voicing. */
function playedOn(chord: ShownChord, instrument: InstrumentName): ShownChord {
  return instrument === 'piano' && chord.songVoicing ? { ...chord, songVoicing: null } : chord;
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
 * What the Chord Chart draws for a Chord as shown: on the guitar, its Song
 * Voicing, if it has one; else the preferred Voicing of it on the device's
 * Instrument (on the guitar, in the tuning), else the top-ranked one, as the
 * Chord Finder would, and as a Chord's popover opens on. Or why it draws
 * none: the Chord can't be read, it has no Voicing, the guitar's tuning
 * can't be read (a null context, from chartContext), or its Song Voicing is
 * on more or fewer strings than the tuning.
 */
export type ChartVoicing =
  | { kind: 'voicing'; voicing: Voicing }
  | { kind: 'unreadable-chord' }
  | { kind: 'no-voicing' }
  | { kind: 'unreadable-tuning' }
  | SongVoicingStrings;

/** A Song Voicing on more or fewer strings than the Song's tuning, so it gets no diagram, rather than a guess. */
export type SongVoicingStrings = { kind: 'song-voicing-strings'; strings: number; tuningStrings: number };

export function chartVoicing(chord: ShownChord, context: FinderContext | null): ChartVoicing {
  const found = chartVoicings(chord, context);
  if (found.kind !== 'voicings') return found;
  const voicing = found.voicings[0];
  return voicing ? { kind: 'voicing', voicing } : { kind: 'no-voicing' };
}

/**
 * What a Chord's popover steps through: every Voicing of the Chord as shown
 * on the device's Instrument, the preferred one first, else the top-ranked,
 * as the Chord Finder lists them; on the guitar, its Song Voicing before
 * them, if it has one, and not again among them. With the Chord's name as
 * the Chord Finder reads it, the name preferring one names it by, whether
 * the first is the Song Voicing, and whether the first of the Chord's own,
 * after any Song Voicing, is preferred. Or why there
 * are none to step through: the Chord or the guitar's tuning can't be read,
 * or the Song Voicing is on more or fewer strings than the tuning. A Chord
 * the Chord Finder can't read still has its Song Voicing to show.
 */
export type ChartVoicings =
  | { kind: 'voicings'; chord: string; voicings: Voicing[]; preferred: boolean; songVoicing: boolean }
  | { kind: 'unreadable-chord' }
  | { kind: 'unreadable-tuning' }
  | SongVoicingStrings;

export function chartVoicings(chord: ShownChord, context: FinderContext | null): ChartVoicings {
  if (!context) return { kind: 'unreadable-tuning' };
  const found = lookUp(chord.name, context);
  const frets = chord.songVoicing;
  if (context.instrument === 'piano' || !frets) {
    if (found.kind !== 'chord') return { kind: 'unreadable-chord' };
    return {
      kind: 'voicings',
      chord: found.name,
      voicings: found.voicings,
      preferred: found.preferred,
      songVoicing: false,
    };
  }
  const strings = context.tuning.length;
  if (frets.length !== strings) return { kind: 'song-voicing-strings', strings: frets.length, tuningStrings: strings };
  const own = found.kind === 'chord' ? found.voicings : [];
  const others = own.filter((v) => !('frets' in v && v.frets.every((f, i) => f === frets[i])));
  return {
    kind: 'voicings',
    chord: found.kind === 'chord' ? found.name : chord.name,
    voicings: [writtenVoicing(frets), ...others],
    // The preferred one comes first among the Chord's own, unless it's the Song Voicing.
    preferred: found.kind === 'chord' && found.preferred && others[0] === own[0],
    songVoicing: true,
  };
}
