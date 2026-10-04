// Transpose: reading a Chord name's root, and a slash chord's bass note, and
// moving them by semitones. Everything else in the name is kept as written,
// and a name that can't be read stays as written. The same rule reads the
// Song's key, whose signature, once moved, spells the moved notes.

/** How a note is spelled at each semitone from C. */
type Spelling = readonly string[];

const common: Spelling = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const sharps: Spelling = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const flats: Spelling = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Each major key's signature, by its note's semitone from C: Db, Eb, F, Ab
 * and Bb major have flats, the rest sharps. C major has none, so it keeps
 * the common spellings. A minor key has its relative major's.
 */
const signatures: Spelling[] = [
  common, // C
  flats, // Db
  sharps, // D
  flats, // Eb
  sharps, // E
  flats, // F
  sharps, // F#
  sharps, // G
  flats, // Ab
  sharps, // A
  flats, // Bb
  sharps, // B
];

const naturals: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const accidentals: Record<string, number> = { '#': 1, '♯': 1, b: -1, '♭': -1, '': 0 };

/** A readable note at the start of text: a capital A–G, optionally followed by #, b, ♯ or ♭. */
const note = /^([A-G])([#b♯♭]?)/u;

/**
 * A solfège name that starts like a letter name: Do or Fa, then the end, an
 * accidental, m, a digit or a non-letter (Do7, Dom7, Fa#m, Fa/Do). Only letter
 * names are readable. Followed by another letter it's English: Fadd9, Faug.
 */
const solfege = /^(Do|Fa)(?=$|[#b♯♭m\d]|\P{L})/u;

/** What, after its note, makes a key minor: m, min or minor, but not M or maj. */
const minor = /^\s*(m|[Mm]in(or)?)(?!\p{L})/u;

/** The readable note at the start of text, or null. */
function readNote(text: string): RegExpExecArray | null {
  return solfege.test(text) ? null : note.exec(text);
}

/**
 * The note at the start of text, read as a Chord's root is: its letter, its
 * semitone from C (0–11), and how many characters it takes. Null if text
 * doesn't start with a readable note. The Chord Finder reads roots with it,
 * so a root Transpose can read, the Finder can too.
 */
export function readRoot(text: string): { letter: string; semitone: number; length: number } | null {
  const m = readNote(text);
  return m && { letter: m[1], semitone: semitone(m, 0), length: m[0].length };
}

/** A readable note moved by semitones, as its semitone from C, 0–11. */
function semitone(m: RegExpExecArray, by: number): number {
  return (((naturals[m[1]] + accidentals[m[2]] + by) % 12) + 12) % 12;
}

/**
 * How a key's signature spells each semitone from C: its tonic's semitone
 * from C, and whether it's minor, which takes its relative major's.
 */
export function signature(tonic: number, isMinor: boolean): Spelling {
  return signatures[isMinor ? (tonic + 3) % 12 : tonic];
}

/**
 * A key read as Transpose reads the Song's key: its tonic's semitone from C,
 * whether it's minor, and its signature. Null if it can't be read. The Chord
 * Finder reads a Key with it, so the two never disagree.
 */
export function readKey(key: string): { tonic: number; minor: boolean; signature: Spelling } | null {
  const moved = moveKey(key, 0);
  return moved && { tonic: moved.at, minor: moved.minor, signature: moved.signature };
}

/** A key moved by semitones: its note's semitone from C, its signature, and the rest as written. Null if unreadable. */
function moveKey(key: string, by: number) {
  const written = key.trim();
  const m = readNote(written);
  if (!m) return null;
  const rest = written.slice(m[0].length);
  const at = semitone(m, by);
  const isMinor = minor.test(rest);
  return { at, minor: isMinor, signature: signature(at, isMinor), rest };
}

/** The note at the start of text moved by semitones and spelled, with the rest of text as written. */
function moveNote(m: RegExpExecArray, text: string, by: number, spelling: Spelling): string {
  return spelling[semitone(m, by)] + text.slice(m[0].length);
}

/**
 * A Chord name moved by semitones. Moved notes are spelled from the
 * signature of the Song's key, moved too, or C# Eb F# Ab Bb without one.
 */
export function transposeChord(name: string, by: number, key = ''): string {
  const root = readNote(name);
  if (!root || by % 12 === 0) return name;
  const spelling = moveKey(key, by)?.signature ?? common;
  const slash = name.lastIndexOf('/');
  const bass = slash > 0 ? readNote(name.slice(slash + 1)) : null;
  if (!bass) return moveNote(root, name, by, spelling);
  return moveNote(root, name.slice(0, slash), by, spelling) + '/' + moveNote(bass, name.slice(slash + 1), by, spelling);
}

/**
 * The Song's key moved by semitones, its note spelled from its own signature
 * and the rest kept as written ("G minor" up 2 is "A minor"). Null when the
 * key can't be read or isn't moved, so it shows as written.
 */
export function transposeKey(key: string, by: number): string | null {
  const moved = by % 12 === 0 ? null : moveKey(key, by);
  return moved && moved.signature[moved.at] + moved.rest;
}
