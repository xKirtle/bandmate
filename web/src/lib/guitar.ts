// The guitar, the Chord Finder's one Instrument so far (ADR 0012). Its
// Voicings are generated, not read from a table: every playable Voicing of a
// Chord on the fretboard of the tuning in use, ranked so the ones most
// players use come first. So any tuning works.

import type { Chord } from './chordTheory';
import { readRoot } from './transpose';

/** A barre: one finger flat across strings at a fret. Strings count from the lowest, 0. */
export interface Barre {
  fret: number;
  from: number;
  to: number;
}

/** One way to play a Chord on the guitar. */
export interface Voicing {
  /** Each string's fret, low string to high, counted from the capo: 0 for open, null for muted. */
  frets: (number | null)[];
  /** The barre the Voicing needs, if it can't be played with four fingers otherwise. */
  barre?: Barre;
}

/** The highest fret a Voicing reaches, counted from the capo. */
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
export function guitarVoicings(chord: Chord, context: { tuning: readonly number[]; capo: number }): Voicing[] {
  const { tuning, capo } = context;
  const pitchClass = (string: number, fret: number) => (tuning[string] + capo + fret) % 12;
  const tones = new Set(chord.quality.tones.map((t) => (chord.root + t.semitones) % 12));
  const required = chord.quality.tones.filter((t) => !t.optional).map((t) => (chord.root + t.semitones) % 12);
  const lowest = chord.bass ?? chord.root;

  const found: { voicing: Voicing; score: number; height: number }[] = [];
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

/** Standard tuning, its strings' pitches low to high, as MIDI note numbers (E2 A2 D3 G3 B3 E4). */
export const standardTuning: readonly number[] = [40, 45, 50, 55, 59, 64];

/**
 * The named tunings, in the Details picker's order, each as its strings'
 * notes, low to high, and the other names it's commonly written as, compared
 * as `compact` leaves them.
 */
export const namedTunings: readonly { name: string; notes: string; aliases: string[] }[] = [
  { name: 'Standard', notes: 'E A D G B E', aliases: ['estandard', 'std', 'estd'] },
  {
    name: 'Half-step down',
    notes: 'Eb Ab Db Gb Bb Eb',
    aliases: ['halfstep', 'halfstepdown', 'ebstandard', 'ebstd', 'd#standard', 'd#std', 'eb'],
  },
  { name: 'Drop D', notes: 'D A D G B E', aliases: [] },
  { name: 'Drop C', notes: 'C G C F A D', aliases: [] },
  { name: 'DADGAD', notes: 'D A D G A D', aliases: [] },
  { name: 'Open G', notes: 'D G D G B D', aliases: [] },
  { name: 'Open D', notes: 'D A D F# A D', aliases: [] },
  { name: 'Open E', notes: 'E B E G# B E', aliases: [] },
];

/** A tuning's name as names are compared: lower case, with no spaces or hyphens, ♭ and ♯ as b and #, and no "tuning" after it. */
function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s-]+/g, '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/tuning$/, '');
}

/**
 * Six notes as the strings' pitches, low to high: each in the octave nearest
 * that string in standard tuning, the lower one when two are as near, as
 * strings are tuned down more often than up.
 */
function pitchesOf(notes: number[]): number[] {
  return notes.map((semitone, string) => {
    const standard = standardTuning[string];
    const up = (((semitone - standard) % 12) + 12) % 12;
    return up < 6 ? standard + up : standard + up - 12;
  });
}

/** A note as read: its semitone from C, and its name with a capital and # or b. */
interface Note {
  semitone: number;
  name: string;
}

/** The note that is the whole of text, or null. */
function readOneNote(text: string): Note | null {
  const note = readRoot(text);
  return note && note.length === text.length ? { semitone: note.semitone, name: tidy(text) } : null;
}

function tidy(note: string): string {
  return note.replace('♯', '#').replace('♭', 'b');
}

/**
 * Notes, low string to high, or null if text isn't only notes. Notes may be
 * separated by spaces, commas or hyphens, each in any case, or run together
 * as capitals (DADGBE), since a lower-case b there could be a flat or a B.
 */
function readNotes(text: string): Note[] | null {
  const written = text.trim();
  if (/[\s,-]/.test(written)) {
    const notes = written.split(/[\s,-]+/).map((n) => readOneNote(n.charAt(0).toUpperCase() + n.slice(1)));
    return notes.every((n) => n !== null) ? notes : null;
  }
  const notes: Note[] = [];
  for (let at = 0; at < written.length;) {
    const note = readRoot(written.slice(at));
    if (!note) return null;
    notes.push({ semitone: note.semitone, name: tidy(written.slice(at, at + note.length)) });
    at += note.length;
  }
  return notes;
}

/**
 * A tuning's text read: its strings' notes and pitches, low to high, and the
 * named tuning it is, if any. Null if it can't be read: it's a named tuning,
 * by its name or an alias, or six notes.
 */
function readTuningText(text: string): { notes: Note[]; pitches: number[]; name: string | null } | null {
  const compacted = compact(text);
  const byName = namedTunings.find((t) => compact(t.name) === compacted || t.aliases.includes(compacted));
  const notes = readNotes(byName ? byName.notes : text);
  if (notes?.length !== standardTuning.length) return null;
  const pitches = pitchesOf(notes.map((n) => n.semitone));
  const same = (t: (typeof namedTunings)[number]) =>
    readNotes(t.notes)!.every((n, string) => n.semitone === notes[string].semitone);
  return { notes, pitches, name: byName?.name ?? namedTunings.find(same)?.name ?? null };
}

/** A tuning's text as its strings' pitches, low to high, or null if it can't be read. */
export function readGuitarTuning(text: string): number[] | null {
  return readTuningText(text)?.pitches ?? null;
}

/** The named tuning a tuning's text reads as, or null if it's another or can't be read. */
export function guitarTuningName(text: string): string | null {
  return readTuningText(text)?.name ?? null;
}

/** A tuning's six notes, low to high, spaced, or null if it can't be read. */
export function guitarTuningNotes(text: string): string | null {
  return (
    readTuningText(text)
      ?.notes.map((n) => n.name)
      .join(' ') ?? null
  );
}

/** A tuning's text as the Details write it: its name if it has one, else its six notes spaced. Null if it can't be read. */
export function guitarTuningText(text: string): string | null {
  return guitarTuningName(text) ?? guitarTuningNotes(text);
}
