// The Chord Chart: how to play the Chords a Song shows, in Read mode. Which
// Chords it draws, and the tuning it draws them for. The Voicings come from
// the Chord Finder (ADR 0012), drawn as its diagrams are.

import type { Song } from './api';
import { chordName, lookUp, readTuning, standard, type FinderContext, type Voicing } from './chordFinder';
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
 * The tuning the Chord Chart draws for, from the Song's: Standard when it's
 * blank, as the Chord Finder reads it otherwise, or null when it can't be
 * read. Never Standard in place of a tuning that can't be read (ADR 0008).
 */
export function chartTuning(text: string): readonly number[] | null {
  return text.trim() === '' ? standard : readTuning(text);
}

/**
 * What the Chord Chart, or a Chord's popover, draws for a Chord as shown: the
 * preferred Voicing of it in the tuning, else the top-ranked one, as the Chord
 * Finder would. Or why it draws none: the Chord can't be read, it has no
 * Voicing in the tuning, or the tuning can't be read (null, from chartTuning).
 */
export type ChartVoicing =
  | { kind: 'voicing'; voicing: Voicing }
  | { kind: 'unreadable-chord' }
  | { kind: 'no-voicing' }
  | { kind: 'unreadable-tuning' };

export function chartVoicing(
  name: string,
  tuning: readonly number[] | null,
  preferred?: FinderContext['preferred'],
): ChartVoicing {
  if (!tuning) return { kind: 'unreadable-tuning' };
  const found = lookUp(name, { tuning, preferred });
  if (found.kind !== 'chord') return { kind: 'unreadable-chord' };
  const voicing = found.voicings[0];
  return voicing ? { kind: 'voicing', voicing } : { kind: 'no-voicing' };
}
