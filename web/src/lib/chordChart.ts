// The Chord Chart: how to play the Chords a Song shows, in Read mode. Which
// Chords it draws, and the tuning it draws them for. The Voicings come from
// the Chord Finder (ADR 0012), drawn as its diagrams are.

import type { Song } from './api';
import { chordName, readTuning, standard } from './chordFinder';
import { activeAlternate } from './sections';
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
  for (const id of song.arrangement)
    for (const line of activeAlternate(sections.get(id))?.lines ?? [])
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
