// The guitar's tunings (ADR 0012): reading a Song's tuning, as text in its
// Details, as the strings' pitches the guitar's Voicings are found on. A
// named tuning reads by its name or a common alias, and six notes read as
// they are; anything else can't be read and stays as written (ADR 0008).

import { readRoot } from './transpose';

/** Standard tuning, its strings' pitches low to high, as MIDI note numbers (E2 A2 D3 G3 B3 E4). */
export const standardTuning: readonly number[] = [40, 45, 50, 55, 59, 64];

interface NamedTuning {
  name: string;
  /** Its strings' notes, low to high. */
  notes: string;
  /** Other names it's commonly written as, as `comparable` leaves them. */
  aliases: string[];
}

/** The named tunings, in the Details picker's order. */
export const namedTunings: readonly NamedTuning[] = [
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

/** Text with ♯ and ♭ written as # and b. */
function plainAccidentals(text: string): string {
  return text.replace(/♯/g, '#').replace(/♭/g, 'b');
}

/** A tuning's name as names are compared: lower case, with no spaces or hyphens, plain accidentals, and no "tuning" after it. */
function comparable(text: string): string {
  return plainAccidentals(text.toLowerCase())
    .replace(/[\s-]+/g, '')
    .replace(/tuning$/, '');
}

/**
 * Six notes as the strings' pitches, low to high: each in the octave nearest
 * that string in standard tuning, the lower one when two are as near, as
 * strings are tuned down more often than up.
 */
function pitchesOf(semitones: number[]): number[] {
  return semitones.map((semitone, string) => {
    const usual = standardTuning[string];
    const up = (((semitone - usual) % 12) + 12) % 12;
    return up < 6 ? usual + up : usual + up - 12;
  });
}

/** A note as read: its semitone from C, and its name with a capital and # or b. */
interface Note {
  semitone: number;
  name: string;
}

/** The note at the start of text, and how many characters it takes, or null. */
function readNote(text: string): { note: Note; length: number } | null {
  const root = readRoot(text);
  return (
    root && {
      note: { semitone: root.semitone, name: plainAccidentals(text.slice(0, root.length)) },
      length: root.length,
    }
  );
}

/**
 * Notes, low string to high, or null if text isn't only notes. Notes may be
 * separated by spaces, commas or hyphens, each in any case, or run together
 * as capitals (DADGBE), since a lower-case b there could be a flat or a B.
 */
function readNotes(text: string): Note[] | null {
  const written = text.trim();
  if (/[\s,-]/.test(written)) {
    const notes = written.split(/[\s,-]+/).map((n) => {
      const read = readNote(n.charAt(0).toUpperCase() + n.slice(1));
      return read?.length === n.length ? read.note : null;
    });
    return notes.every((n) => n !== null) ? notes : null;
  }
  const notes: Note[] = [];
  for (let at = 0; at < written.length;) {
    const read = readNote(written.slice(at));
    if (!read) return null;
    notes.push(read.note);
    at += read.length;
  }
  return notes;
}

/** A tuning as read from its text. */
interface Tuning {
  /** Its strings' notes, low to high. */
  notes: Note[];
  /** Its strings' pitches, low to high, as MIDI note numbers. */
  pitches: number[];
  /** The named tuning it is, if any. */
  name: string | null;
}

/** A tuning's text read: a named tuning, by its name or an alias, or six notes. Null if it's neither. */
function readTuning(text: string): Tuning | null {
  const name = comparable(text);
  const byName = namedTunings.find((t) => comparable(t.name) === name || t.aliases.includes(name));
  const notes = readNotes(byName ? byName.notes : text);
  if (notes?.length !== standardTuning.length) return null;
  const sameNotes = (t: NamedTuning) => readNotes(t.notes)!.every((n, string) => n.semitone === notes[string].semitone);
  return {
    notes,
    pitches: pitchesOf(notes.map((n) => n.semitone)),
    name: byName?.name ?? namedTunings.find(sameNotes)?.name ?? null,
  };
}

/** A tuning's text as its strings' pitches, low to high, or null if it can't be read. */
export function readGuitarTuning(text: string): number[] | null {
  return readTuning(text)?.pitches ?? null;
}

/** The named tuning a tuning's text reads as, or null if it's another or can't be read. */
export function guitarTuningName(text: string): string | null {
  return readTuning(text)?.name ?? null;
}

/** A tuning's six notes, low to high, spaced, or null if it can't be read. */
export function guitarTuningNotes(text: string): string | null {
  return (
    readTuning(text)
      ?.notes.map((n) => n.name)
      .join(' ') ?? null
  );
}

/** A tuning's text as the Details write it: its name if it has one, else its six notes spaced. Null if it can't be read. */
export function guitarTuningText(text: string): string | null {
  return guitarTuningName(text) ?? guitarTuningNotes(text);
}
