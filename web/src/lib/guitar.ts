// The guitar, the Chord Finder's one Instrument so far (ADR 0012). Its
// Voicings are generated, not read from a table: every playable Voicing of a
// Chord on the fretboard of the tuning in use, ranked so the ones most
// players use come first. So any tuning works.

import type { Chord } from './chordTheory';

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
 */
function score(frets: (number | null)[], lowestIsRoot: boolean): number {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const open = frets.filter((f) => f === 0).length;
  const mutedBelow = frets.findIndex((f) => f !== null);
  const mutedAbove = [...frets].reverse().findIndex((f) => f !== null);
  const position = fretted.length ? Math.min(...fretted) : 0;
  const stretch = fretted.length ? Math.max(...fretted) - position : 0;
  return (lowestIsRoot ? 15 : 0) + 3 * open - 2 * mutedBelow - 4 * mutedAbove - 2 * position - stretch;
}

/** The sum of a Voicing's frets, which breaks a tie in score: the lower the hand, the sooner. */
const height = (frets: (number | null)[]) => frets.reduce<number>((sum, f) => sum + (f ?? 0), 0);

/**
 * Every playable Voicing of a Chord on a guitar, best first. A Voicing holds
 * every tone the Chord can't do without, sounds nothing outside it, has no
 * muted string between sounding ones, and fits a hand: four frets, four
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
    frets.push(null);
    // Once a string is muted after sounding ones, every string above it is muted too.
    place(string + 1, low, high, soundingYet);
    frets.pop();
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
