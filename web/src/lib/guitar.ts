// The guitar, the Chord Finder's one Instrument so far (ADR 0012). Its
// Voicings are generated, not read from a table: every playable Voicing of a
// Chord on the fretboard of the tuning in use, ranked so the ones most
// players use come first. So any tuning works.

import type { Chord } from './chordTheory';
import type { HeardNote, Instrument } from './instrument';
import { standardTuning } from './guitarTuning';
import { sampleFileName, type SampleSet } from './samples';

/** The frets placed on a guitar, low string to high: 0 for open, null for muted. */
export type Frets = readonly (number | null)[];

/** A barre: one finger flat across strings at a fret. Strings count from the lowest, 0. */
export interface Barre {
  fret: number;
  from: number;
  to: number;
}

/** One way to play a Chord on the guitar. */
export interface GuitarVoicing {
  /** Each string's fret, low string to high: 0 for open, null for muted. */
  frets: (number | null)[];
  /** The barre the Voicing needs, if it can't be played with four fingers otherwise. */
  barre?: Barre;
}

/** The highest fret a Voicing reaches. */
const highestFret = 12;
/** The highest fret a first-position Voicing, like the open Chords, reaches. */
const firstPositionFret = 3;
/** How many bass strings may be muted under the bass: the 6th and 5th, for a bass on the 4th. */
const mutedUnder = 2;
/** The most frets a hand spans: from its lowest fretted note to its highest, 3 apart is 4 frets. */
const widestStretch = 3;
const fingers = 4;

/**
 * How a Voicing is played: with no barre, or with one across the strings at
 * its lowest fret. Null if it takes more than four fingers either way.
 */
function barreFor(frets: (number | null)[]): { barre?: Barre } | null {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  if (fretted.length <= fingers) return {};
  const fret = Math.min(...fretted);
  const from = frets.indexOf(fret);
  const to = frets.lastIndexOf(fret);
  // A barre presses every string it lies across, so none of them rings open or is muted.
  const covered = frets.slice(from, to + 1);
  if (from === to || covered.some((f) => f === null || f < fret)) return null;
  if (1 + fretted.filter((f) => f > fret).length > fingers) return null;
  return { barre: { fret, from, to } };
}

/**
 * How good a Voicing is to play; higher first. The root (or a slash Chord's
 * bass) as the lowest note counts most, then open strings, then fewer muted
 * strings, a lower position and a smaller stretch. A muted string above the
 * sounding ones costs twice what one below them does: a bass string is just
 * not strummed, but a treble one has to be damped by a fretting finger.
 * Open strings only count for a Voicing in first position, every finger on
 * the 3rd fret or below, like the open Chords players learn first. Up the
 * neck an open string counts a little against it: an unusual sound and a
 * reach (Bm's x24432 before x20402).
 */
function score(frets: (number | null)[], lowestIsRoot: boolean): number {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const open = frets.filter((f) => f === 0).length;
  const mutedBelow = frets.findIndex((f) => f !== null);
  const mutedAbove = [...frets].reverse().findIndex((f) => f !== null);
  const position = fretted.length ? Math.min(...fretted) : 0;
  const stretch = fretted.length ? Math.max(...fretted) - position : 0;
  const firstPosition = fretted.every((f) => f <= firstPositionFret);
  return (
    (lowestIsRoot ? 15 : 0) + (firstPosition ? 3 : -2) * open - 2 * mutedBelow - 4 * mutedAbove - 2 * position - stretch
  );
}

/** The sum of a Voicing's frets, which breaks a tie in score: the lower the hand, the sooner. */
const height = (frets: (number | null)[]) => frets.reduce<number>((sum, f) => sum + (f ?? 0), 0);

/**
 * Every playable Voicing of a Chord on a guitar, best first. A Voicing holds
 * every tone the Chord can't do without, sounds nothing outside it, has no
 * muted string between sounding ones, has its bass on the 6th, 5th or 4th
 * string (treble strings may be muted), and fits a hand: four frets, four
 * fingers, a barre counting as one. A slash Chord's bass is its lowest note.
 */
function guitarVoicings(chord: Chord, tuning: readonly number[]): GuitarVoicing[] {
  const pitchClass = (string: number, fret: number) => (tuning[string] + fret) % 12;
  const tones = new Set(chord.quality.tones.map((t) => (chord.root + t.semitones) % 12));
  const required = chord.quality.tones.filter((t) => !t.optional).map((t) => (chord.root + t.semitones) % 12);
  const lowest = chord.bass ?? chord.root;

  const found: { voicing: GuitarVoicing; score: number; height: number }[] = [];
  const frets: (number | null)[] = [];

  function finish() {
    const first = frets.findIndex((f) => f !== null);
    if (first < 0) return;
    const sounding = frets.flatMap((f, s) => (f === null ? [] : [pitchClass(s, f)]));
    // A slash bass outside the Chord sounds only as its lowest note.
    if (sounding.slice(1).some((pc) => !tones.has(pc))) return;
    if (chord.bass !== null && sounding[0] !== chord.bass) return;
    if (!required.every((pc) => sounding.includes(pc))) return;
    const barre = barreFor(frets);
    if (!barre) return;
    const played = [...frets];
    found.push({
      voicing: { frets: played, ...barre },
      score: score(played, sounding[0] === lowest),
      height: height(played),
    });
  }

  /** Tries every fret on each string in turn, low to high. */
  function place(string: number, low: number, high: number, ended: boolean) {
    if (string === tuning.length) return finish();
    const soundingYet = frets.some((f) => f !== null);
    // Once a string is muted after sounding ones, every string above it is
    // muted too. Under the bass, only the 6th and 5th strings may be muted.
    if (soundingYet || string < mutedUnder) {
      frets.push(null);
      place(string + 1, low, high, soundingYet);
      frets.pop();
    }
    if (ended) return;
    for (let fret = 0; fret <= highestFret; fret++) {
      const pc = pitchClass(string, fret);
      if (!tones.has(pc) && !(pc === chord.bass && !soundingYet)) continue;
      const lo = fret > 0 ? Math.min(low, fret) : low;
      const hi = fret > 0 ? Math.max(high, fret) : high;
      if (hi - lo > widestStretch) continue;
      frets.push(fret);
      place(string + 1, lo, hi, false);
      frets.pop();
    }
  }
  place(0, Infinity, -Infinity, false);

  return found.sort((a, b) => b.score - a.score || a.height - b.height).map((f) => f.voicing);
}

/**
 * The fret a chord diagram of a Voicing starts at, its first of `rows` rows:
 * a barre's fret, so the barre lies on the first row; else 1, under the nut,
 * for a Voicing that fits there; else the lowest fret the Voicing presses.
 */
export function diagramStartFret(voicing: GuitarVoicing, rows: number): number {
  if (voicing.barre) return voicing.barre.fret;
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
  return fretted.length === 0 || Math.max(...fretted) <= rows ? 1 : Math.min(...fretted);
}

/** What strumming frets on a guitar plays, low string to high, muted strings skipped: each string's MIDI note number, on that string. */
function guitarHeardNotes(frets: Frets, tuning: readonly number[]): HeardNote[] {
  return frets.flatMap((fret, string) => (fret === null ? [] : [{ midi: tuning[string] + fret, string }]));
}

/** The frets recorded on each string: every 3, so no note in its tuning is pitch-shifted more than a semitone. */
const recordedFrets = [0, 3, 6, 9, 12];

/**
 * The guitar's recorded samples: the University of Iowa Musical Instrument
 * Samples' Raimundo 118, a nylon-string classical, recorded string by
 * string, at frets 0, 3, 6, 9 and 12 of each of standard tuning's strings,
 * so a note sounds as its own string does there (#1209). Each string's are
 * served from a folder named by its open note. A string tuned away from
 * standard still plays its own recordings, from the nearest: Drop D's low
 * D is the low E's open string pitched down. Its gain matches the strum of C
 * to the guitar's before (#1207), and leaves every Voicing measured at least
 * 5 dB from clipping.
 */
export const guitarSamples: SampleSet = {
  name: 'Guitar',
  samples: standardTuning.flatMap((open, string) => recordedFrets.map((fret) => ({ note: open + fret, string }))),
  url: ({ note, string = 0 }) =>
    `${import.meta.env.BASE_URL}samples/guitar/${sampleFileName(standardTuning[string])}/${sampleFileName(note)}.mp3`,
  gain: 0.64,
};

/**
 * The guitar in a tuning, its strings' pitches low to high as MIDI note
 * numbers. It plays its recorded samples, which Hear strums, low string to
 * high. The notes placed on it are its frets, and a preferred Voicing is
 * kept by its frets, per tuning: a Voicing preferred in standard tuning
 * doesn't pick a wrong one in Drop D. The tuning is kept by its pitches, so
 * "Drop D" and "D A D G B E" share.
 */
export function guitar(tuning: readonly number[]): Instrument<GuitarVoicing, Frets, Frets> {
  return {
    voicings: (chord) => guitarVoicings(chord, tuning),
    placement: (voicing) => voicing.frets,
    heardNotes: (frets) => guitarHeardNotes(frets, tuning),
    sound: { samples: guitarSamples, strummed: true },
    preferredStorageKey: `bandmate.preferredVoicings.guitar.${tuning.join('-')}`,
    preference: (voicing) => voicing.frets,
    prefers: (voicing, frets) => voicing.frets.length === frets.length && voicing.frets.every((f, i) => f === frets[i]),
    isPreference: (kept): kept is Frets =>
      Array.isArray(kept) &&
      kept.length === tuning.length &&
      kept.every((f) => f === null || (Number.isInteger(f) && f >= 0)),
  };
}
