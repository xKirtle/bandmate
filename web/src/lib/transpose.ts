// Transpose: reading a Chord name's root, and a slash chord's bass note, and
// moving them by semitones. Everything else in the name is kept as written,
// and a name that can't be read stays as written. The same rule reads the
// Song's key, whose signature, once moved, spells the moved notes. The same
// signatures spell the one list of Keys offered wherever a Key is picked.

/** How a note is spelled at each semitone from C. */
export type Spelling = readonly string[];

const common: Spelling = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const sharps: Spelling = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const flats: Spelling = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Each major key's plain signature, by its note's semitone from C: Db, Eb, F,
 * Ab and Bb major have flats, the rest sharps. C major has none, so it keeps
 * the common spellings. Plain, because every semitone takes one of the twelve
 * everyday spellings, none of them a letter the key has spent already: the
 * signature `byLetter` derives from it spells the key's own seven exactly.
 */
const plainSignatures: Spelling[] = [
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

/** The seven letters a scale steps through, in order, so the next one wraps round to C. */
const letters = 'CDEFGAB';

/** The major scale's semitones above its tonic. */
const majorScale = [0, 2, 4, 5, 7, 9, 11];

/**
 * A plain signature with the key's own seven notes spelled by letter: each
 * degree takes the next letter, then whatever accidental lands it on the
 * right pitch, since a scale uses each of the seven letters exactly once. So
 * F# major, F# G# A# B C# D# E#, spells semitone 5 E#, not F, and its vii° is
 * E#dim. The other five semitones keep the plain spelling, the one a note
 * outside the key is written with.
 */
function byLetter(plain: Spelling, tonic: number): Spelling {
  const spelled = [...plain];
  const first = letters.indexOf(plain[tonic][0]);
  majorScale.forEach((step, degree) => {
    const letter = letters[(first + degree) % 7];
    const semitone = (tonic + step) % 12;
    // How far the letter is from the pitch, as -5…6, so the accidental is the shorter way round.
    const accidental = ((semitone - naturals[letter] + 18) % 12) - 6;
    spelled[semitone] = letter + (accidental < 0 ? 'b'.repeat(-accidental) : '#'.repeat(accidental));
  });
  return spelled;
}

/** Each major key's signature with its own seven notes spelled by letter. */
const signatures: Spelling[] = plainSignatures.map(byLetter);

/** The major key a key's signature is: its own, or a minor key's relative major. */
const relativeMajor = (tonic: number, isMinor: boolean) => (isMinor ? (tonic + 3) % 12 : tonic);

/**
 * How a key's signature spells each semitone from C: its tonic's semitone
 * from C, and whether it's minor, which takes its relative major's. The key's
 * own seven notes are spelled by letter, so F# major spells semitone 5 E#.
 */
export function signature(tonic: number, isMinor: boolean): Spelling {
  return signatures[relativeMajor(tonic, isMinor)];
}

/**
 * The same signature without the key's own letters: every semitone written
 * with one of the twelve everyday spellings, F rather than E#. It's what a
 * Chord outside the key is written with, one a player writes the easy way
 * rather than with the double accidentals the letter would need.
 */
export function plainSignature(tonic: number, isMinor: boolean): Spelling {
  return plainSignatures[relativeMajor(tonic, isMinor)];
}

/**
 * The Keys offered wherever one is picked — a Song's and a Beat's Key, and
 * the Chord Finder's Suggest — all 24, interleaved by tonic, each tonic's
 * major then the minor on it. Each is spelled from its own signature, so the
 * list never offers a Key no signature can write: Db, not D# major, which
 * would need nine sharps. A Key field stays free text, so C# typed by hand is
 * kept as written.
 */
export const keys: readonly string[] = signatures.flatMap((_, tonic) => [
  signature(tonic, false)[tonic],
  signature(tonic, true)[tonic] + 'm',
]);

/** A key as Transpose reads it: its tonic's semitone from C, whether it's minor, and its signature. */
export interface ReadKey {
  tonic: number;
  minor: boolean;
  signature: Spelling;
}

/**
 * A key read as Transpose reads the Song's key: its tonic's semitone from C,
 * whether it's minor, and its signature. Null if it can't be read. The Chord
 * Finder reads a Key with it, so the two never disagree.
 */
export function readKey(key: string): ReadKey | null {
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
