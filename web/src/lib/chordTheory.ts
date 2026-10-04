// Chord theory that knows no Instrument (ADR 0012): a Chord name gives its
// notes, notes give the Chord names that fit them, and a Key gives the Chords
// that go with it. The Chord Finder (chordFinder.ts) is the one way in; the
// Instruments that voice a Chord build on what this reads.

import { readKey as readKeyText, readRoot, signature } from './transpose';

/** One note of a Chord, as an interval above its root. */
export interface Tone {
  /** Semitones above the root. */
  semitones: number;
  /** Its degree (1 for the root, 3 for the third, 9 for the ninth…), which spells it. */
  degree: number;
  /** Whether a Voicing may leave it out, as the fifth of a larger Chord. */
  optional: boolean;
}

/** A quality from the known set, as the Chord Finder's picker names it. */
export interface Quality {
  /** How a name writes it after the root: '' for major. */
  suffix: string;
  /** What the picker shows for it. */
  label: string;
  tones: Tone[];
}

/**
 * A quality's tones in degree notation: 1 3 5 for major, b3 for a minor
 * third, and so on. A tone in brackets is optional, one a Voicing may leave
 * out. The fifth is optional in Chords of four notes or more, as it adds
 * little; an altered fifth (b5, #5) is what gives a Chord its sound, so it
 * stays.
 */
const degrees: Record<string, [semitones: number, degree: number]> = {
  '1': [0, 1],
  '2': [2, 2],
  b3: [3, 3],
  '3': [4, 3],
  '4': [5, 4],
  b5: [6, 5],
  '5': [7, 5],
  '#5': [8, 5],
  '6': [9, 6],
  bb7: [9, 7],
  b7: [10, 7],
  '7': [11, 7],
  b9: [13, 9],
  '9': [14, 9],
  '#9': [15, 9],
  '11': [17, 11],
  '13': [21, 13],
};

function tones(formula: string): Tone[] {
  return formula.split(' ').map((d) => {
    const optional = d.startsWith('(');
    const [semitones, degree] = degrees[d.replace(/[()]/g, '')];
    return { semitones, degree, optional };
  });
}

/**
 * The known qualities, in the picker's order, each with the spellings a name
 * may write it in after the root. `{m}` stands for any way of writing minor
 * (m, min, -), `{M}` for any way of writing a major seventh (maj, Maj, M, Δ).
 * Brackets in a name are ignored, so m7(b5) reads as m7b5. A 13 Chord leaves
 * out the eleventh, which clashes with the third, as players usually do.
 */
const known: { suffix: string; formula: string; spellings: string[] }[] = [
  { suffix: '', formula: '1 3 5', spellings: ['', 'maj', 'Maj', 'M'] },
  { suffix: 'm', formula: '1 b3 5', spellings: ['{m}'] },
  { suffix: '5', formula: '1 5', spellings: ['5'] },
  { suffix: '6', formula: '1 3 (5) 6', spellings: ['6'] },
  { suffix: 'm6', formula: '1 b3 (5) 6', spellings: ['{m}6'] },
  { suffix: '7', formula: '1 3 (5) b7', spellings: ['7'] },
  { suffix: 'maj7', formula: '1 3 (5) 7', spellings: ['{M}7', 'Δ'] },
  { suffix: 'm7', formula: '1 b3 (5) b7', spellings: ['{m}7'] },
  { suffix: 'mMaj7', formula: '1 b3 (5) 7', spellings: ['{m}{M}7', '{m}Δ'] },
  { suffix: 'dim', formula: '1 b3 b5', spellings: ['dim', '°', 'o'] },
  { suffix: 'dim7', formula: '1 b3 b5 bb7', spellings: ['dim7', '°7', 'o7'] },
  { suffix: 'm7b5', formula: '1 b3 b5 b7', spellings: ['{m}7b5', 'ø', 'ø7'] },
  { suffix: 'aug', formula: '1 3 #5', spellings: ['aug', '+'] },
  { suffix: 'sus2', formula: '1 2 5', spellings: ['sus2'] },
  { suffix: 'sus4', formula: '1 4 5', spellings: ['sus4', 'sus'] },
  { suffix: '7sus4', formula: '1 4 (5) b7', spellings: ['7sus4', '7sus'] },
  { suffix: 'add9', formula: '1 3 (5) 9', spellings: ['add9'] },
  { suffix: 'madd9', formula: '1 b3 (5) 9', spellings: ['{m}add9'] },
  { suffix: '9', formula: '1 3 (5) b7 9', spellings: ['9'] },
  { suffix: 'maj9', formula: '1 3 (5) 7 9', spellings: ['{M}9'] },
  { suffix: 'm9', formula: '1 b3 (5) b7 9', spellings: ['{m}9'] },
  { suffix: '11', formula: '1 3 (5) b7 (9) 11', spellings: ['11'] },
  { suffix: '13', formula: '1 3 (5) b7 (9) 13', spellings: ['13'] },
  { suffix: '7b9', formula: '1 3 (5) b7 b9', spellings: ['7b9'] },
  { suffix: '7#9', formula: '1 3 (5) b7 #9', spellings: ['7#9'] },
];

export const qualities: readonly Quality[] = known.map(({ suffix, formula }) => ({
  suffix,
  label: suffix || 'major',
  tones: tones(formula),
}));

const minors = ['m', 'min', '-'];
const majorSevenths = ['maj', 'Maj', 'M', 'Δ'];

/** Every spelling of a quality, written out, to the quality it reads as. */
const bySpelling = new Map<string, Quality>();
known.forEach(({ spellings }, i) => {
  for (const spelling of spellings)
    for (const m of spelling.includes('{m}') ? minors : [''])
      for (const M of spelling.includes('{M}') ? majorSevenths : [''])
        bySpelling.set(spelling.replace('{m}', m).replace('{M}', M), qualities[i]);
});

/** The roots the picker offers, C to B, with sharps and flats. */
export const roots = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

/** A Chord read from its name. */
export interface Chord {
  /** The name as read, tidied: ♯ and ♭ written # and b, the quality as the picker writes it. */
  name: string;
  /** The root's semitone from C, 0–11, and as written, with # or b. */
  root: number;
  rootName: string;
  quality: Quality;
  /** A slash Chord's bass note, as its semitone from C and as written, or null. */
  bass: number | null;
  bassName: string | null;
  /** The Chord's notes, root first, then the bass if it isn't one of them. */
  notes: string[];
}

const letters = 'CDEFGAB';
const naturals = [0, 2, 4, 5, 7, 9, 11];
const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const common = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** A note as read at the start of a name, with how it was written. */
interface Read {
  letter: string;
  semitone: number;
  length: number;
  /** Its accidental, written # or b, or ''. */
  accidental: string;
}

function read(text: string): Read | null {
  const r = readRoot(text);
  if (!r) return null;
  const sign = text.slice(1, r.length);
  return { ...r, accidental: sign === '♯' ? '#' : sign === '♭' ? 'b' : sign };
}

/**
 * A tone spelled from the root's letter, so its letter follows the degree
 * (the third of F# is A#, of Eb is G). One that would need a double sharp or
 * flat is spelled the simple way instead (C dim7's seventh is A, not Bbb).
 */
function spell(root: Read, tone: Tone): string {
  const letter = (letters.indexOf(root.letter) + tone.degree - 1) % 7;
  const at = (root.semitone + tone.semitones) % 12;
  const off = ((at - naturals[letter] + 18) % 12) - 6;
  if (off === 0) return letters[letter];
  if (off === 1) return letters[letter] + '#';
  if (off === -1) return letters[letter] + 'b';
  return (root.accidental === '#' ? sharps : root.accidental === 'b' ? flats : common)[at];
}

/**
 * Reads a Chord name: a root read the way Transpose reads one, a quality
 * from the known set in any of its spellings, and an optional slash bass.
 * Null for anything else, never a guess at a near name.
 */
export function readChord(text: string): Chord | null {
  const name = text.trim();
  const root = read(name);
  if (!root) return null;
  const slash = name.indexOf('/', root.length);
  const suffix = name.slice(root.length, slash < 0 ? undefined : slash);
  const quality = bySpelling.get(suffix.replace(/[()]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#'));
  if (!quality) return null;
  let bass: Read | null = null;
  if (slash >= 0) {
    bass = read(name.slice(slash + 1));
    if (!bass || bass.length !== name.length - slash - 1) return null;
  }
  const rootName = root.letter + root.accidental;
  const notes = quality.tones.map((t) => spell(root, t));
  const bassName = bass && bass.letter + bass.accidental;
  const bassIsTone = bass && quality.tones.some((t) => toneAt(root.semitone, t) === bass.semitone);
  if (bassName && !bassIsTone) notes.push(bassName);
  return {
    name: rootName + quality.suffix + (bassName ? '/' + bassName : ''),
    root: root.semitone,
    rootName,
    quality,
    bass: bass && bass.semitone,
    bassName,
    notes,
  };
}

/** A tone's note above a root, as its semitone from C, 0–11. */
const toneAt = (root: number, tone: Tone) => (root + tone.semitones) % 12;

/** How many sharps and flats a Chord's notes are written with. */
const accidentalCount = (chord: Chord) => chord.notes.join('').replace(/[^#b]/g, '').length;

/** Each note of a Chord's, as its semitone from C, to how the Chord spells it. */
function spellingOf(chord: Chord): Map<number, string> {
  return new Map(chord.quality.tones.map((t, i) => [toneAt(chord.root, t), chord.notes[i]]));
}

/**
 * The Chords that fit notes sounding, best first: every root and quality
 * from the known set whose tones hold every note sounding and every tone the
 * quality can't do without. A lowest note that isn't the root is a slash
 * bass, so a bass is always one of the Chord's tones. Notes are semitones
 * from C, 0–11, lowest first.
 *
 * Readings with the root as the lowest note come first, then the simpler
 * ones, with fewer tones. The best reading's root is written sharp or flat,
 * whichever writes its notes with fewer sharps and flats (G#m, not Abm with
 * its Cb), the common way when that's a tie; every other reading writes each
 * note the way the best one does, so a note is never Bb in one and A# in
 * another.
 */
export function nameNotes(notes: readonly number[]): Chord[] {
  const bass = notes[0];
  const sounding = new Set(notes);
  const fits: { root: number; quality: Quality }[] = [];
  for (const root of sounding) {
    for (const quality of qualities) {
      const at = quality.tones.map((t) => toneAt(root, t));
      const required = at.filter((_, i) => !quality.tones[i].optional);
      if ([...sounding].every((n) => at.includes(n)) && required.every((n) => sounding.has(n)))
        fits.push({ root, quality });
    }
  }
  if (fits.length === 0) return [];
  const rootInBass = (f: { root: number }) => (f.root === bass ? 0 : 1);
  fits.sort((a, b) => rootInBass(a) - rootInBass(b) || a.quality.tones.length - b.quality.tones.length);

  const best = fits[0];
  const spellings = [...new Set([common[best.root], sharps[best.root], flats[best.root]])];
  const bestSpelled = spellings
    .flatMap((root) => readChord(root + best.quality.suffix) ?? [])
    .reduce((a, b) => (accidentalCount(b) < accidentalCount(a) ? b : a));
  const spelling = spellingOf(bestSpelled);
  const spell = (n: number) => spelling.get(n) ?? common[n];
  return fits.flatMap(
    ({ root, quality }) => readChord(spell(root) + quality.suffix + (root === bass ? '' : '/' + spell(bass))) ?? [],
  );
}

/**
 * Notes sounding, each once in the order given, spelled as a Chord they're
 * read as spells them (D# in B, not Eb), or the common way with none.
 * Notes are semitones from C, 0–11.
 */
export function spellNotes(notes: readonly number[], chord: Chord | null): string[] {
  const spelling = chord ? spellingOf(chord) : new Map<number, string>();
  return [...new Set(notes)].map((n) => spelling.get(n) ?? common[n]);
}

/** A Key read from its text. */
export interface Key {
  /** Its tonic's semitone from C, 0–11. */
  tonic: number;
  minor: boolean;
  /** How its signature spells each semitone from C, as Transpose spells it. */
  signature: readonly string[];
  /** Its name, tidied: G major, E minor. */
  name: string;
}

/** Reads a Key the way Transpose reads the Song's key, or null if it can't be read. */
export function readKey(text: string): Key | null {
  const key = readKeyText(text);
  return key && { ...key, name: key.signature[key.tonic] + (key.minor ? ' minor' : ' major') };
}

/** A Chord that goes with a Key, as Suggest shows it. */
export interface Suggestion {
  /** Its name, spelled from the Key's signature. */
  chord: string;
  /** Its Roman numeral in the Key: V, vii°, bVII, V/ii. */
  numeral: string;
  /** Why it fits, in a few words. */
  reason: string;
  /** One of the Key's own Chords, one borrowed from its parallel minor, or the V of one of its own. */
  kind: 'diatonic' | 'borrowed' | 'secondary';
}

/** A Chord a Key holds: its numeral, its root in semitones above the tonic, its quality's suffix, and why it fits. */
type Degree = [numeral: string, semitones: number, suffix: string, reason: string];

/** A major Key's own Chords. */
const majorDegrees: Degree[] = [
  ['I', 0, '', 'Home'],
  ['ii', 2, 'm', 'Leads on to V'],
  ['iii', 4, 'm', 'Shares two notes with I'],
  ['IV', 5, '', 'Moves away from home'],
  ['V', 7, '', 'Pulls back home to I'],
  ['vi', 9, 'm', 'The relative minor'],
  ['vii°', 11, 'dim', 'Pulls hard to I'],
];

/** A minor Key's own Chords: natural minor's, then V from harmonic minor. */
const minorDegrees: Degree[] = [
  ['i', 0, 'm', 'Home'],
  ['ii°', 2, 'dim', 'Leads on to V'],
  ['III', 3, '', 'The relative major'],
  ['iv', 5, 'm', 'Moves away from home'],
  ['v', 7, 'm', 'A soft pull back home'],
  ['VI', 8, '', 'Shares two notes with i'],
  ['VII', 10, '', 'Steps down from home'],
  ['V', 7, '7', 'From harmonic minor, pulls hard to i'],
];

/** The Chords a major Key commonly borrows from its parallel minor; the reason names the minor Key. */
const borrowedDegrees: Degree[] = [
  ['iv', 5, 'm', ''],
  ['bIII', 3, '', ''],
  ['bVI', 8, '', ''],
  ['bVII', 10, '', ''],
];

type Moves = Record<string, [numeral: string, reason: string][]>;

/**
 * The Chords that usually follow each of a major Key's Chords, by numeral:
 * functional moves, as V to I and IV to I, and the deceptive V to vi.
 */
const majorMoves: Moves = {
  I: [
    ['IV', 'Moves away from home'],
    ['V', 'Builds tension'],
    ['vi', 'Turns to the relative minor'],
  ],
  ii: [
    ['V', 'Sets up the pull home'],
    ['vii°', 'Leads on to I'],
  ],
  iii: [
    ['vi', 'Down a fifth'],
    ['IV', 'Steps up'],
  ],
  IV: [
    ['I', 'Plagal, back home'],
    ['V', 'Builds to the dominant'],
    ['ii', 'Its relative minor'],
  ],
  V: [
    ['I', 'Resolves home'],
    ['vi', 'Deceptive: vi in place of I'],
  ],
  vi: [
    ['ii', 'Down a fifth'],
    ['IV', 'Steps down'],
    ['V', 'Builds to the dominant'],
  ],
  'vii°': [
    ['I', 'Resolves home'],
    ['iii', 'Down a fifth'],
  ],
  iv: [
    ['I', 'Minor plagal, back home'],
    ['V', 'Builds to the dominant'],
  ],
  bIII: [
    ['IV', 'Steps up'],
    ['bVI', 'Down a fifth'],
  ],
  bVI: [
    ['bVII', 'Steps up'],
    ['V', 'Steps down to the dominant'],
  ],
  bVII: [
    ['I', 'Steps up home'],
    ['IV', 'Down a fifth'],
  ],
};

/** The same for a minor Key's Chords. */
const minorMoves: Moves = {
  i: [
    ['iv', 'Moves away from home'],
    ['V', 'Builds tension'],
    ['VI', 'Steps up'],
    ['VII', 'Steps down'],
  ],
  'ii°': [['V', 'Sets up the pull home']],
  III: [
    ['VI', 'Down a fifth'],
    ['iv', 'Steps up'],
  ],
  iv: [
    ['V', 'Builds to the dominant'],
    ['i', 'Plagal, back home'],
    ['VII', 'Down a fifth'],
  ],
  v: [
    ['i', 'A soft pull back home'],
    ['VI', 'Steps up'],
  ],
  V: [
    ['i', 'Resolves home'],
    ['VI', 'Deceptive: VI in place of i'],
  ],
  VI: [
    ['VII', 'Steps up'],
    ['iv', 'Steps down'],
    ['ii°', 'Leads on to V'],
  ],
  VII: [
    ['III', 'Down a fifth, to the relative major'],
    ['i', 'Steps up home'],
  ],
};

/** A Chord a Key holds, with its root's semitone from C and its quality's suffix. */
interface KeyChord extends Suggestion {
  root: number;
  suffix: string;
  /** A secondary dominant's Chord, the one it's the V of. */
  of?: KeyChord;
}

const suggestion = ({ chord, numeral, reason, kind }: KeyChord): Suggestion => ({ chord, numeral, reason, kind });

/**
 * Every Chord that goes with a Key: its own, then those a major Key borrows
 * from its parallel minor, then the V of each of its own but the tonic and a
 * diminished one. Each is spelled from the Key's signature, as Transpose
 * spells Chords, and a borrowed one from its parallel minor's. A flat Key's
 * borrowed Chords stay flat, since Transpose reads the parallel minor of Eb,
 * Ab and Db as sharp (Eb minor as D# minor).
 */
function keyChords(key: Key): KeyChord[] {
  const at = (degree: Degree, kind: Suggestion['kind'], spelling: readonly string[], reason: string): KeyChord => {
    const root = (key.tonic + degree[1]) % 12;
    return { chord: spelling[root] + degree[2], numeral: degree[0], reason, kind, root, suffix: degree[2] };
  };
  const own = (key.minor ? minorDegrees : majorDegrees).map((d) => at(d, 'diatonic', key.signature, d[3]));
  const flatKey = key.signature[1] === 'Db';
  const parallel = flatKey ? key.signature : signature(key.tonic, true);
  const borrowed = key.minor
    ? []
    : borrowedDegrees.map((d) => at(d, 'borrowed', parallel, `Borrowed from ${key.signature[key.tonic]} minor`));
  const secondary = own.slice(1).flatMap((c): KeyChord[] => {
    if (c.suffix === 'dim' || c.suffix === '7') return [];
    const root = (c.root + 7) % 12;
    return [
      {
        chord: key.signature[root] + '7',
        numeral: 'V/' + c.numeral,
        reason: `V of ${c.chord}`,
        kind: 'secondary',
        root,
        suffix: '7',
        of: c,
      },
    ];
  });
  return [...own, ...borrowed, ...secondary];
}

/** The Chords that go with a Key: its own, then the borrowed ones, then the secondary dominants. */
export function suggestFromKey(key: Key): Suggestion[] {
  return keyChords(key).map(suggestion);
}

/** A quality's triad, as a suffix: '' major, 'm' minor or 'dim', or null with no third (5, sus) or an augmented fifth. */
function triad(quality: Quality): string | null {
  const has = (n: number) => quality.tones.some((t) => t.semitones === n);
  if (has(8)) return null;
  if (has(4)) return '';
  if (has(3)) return has(6) ? 'dim' : 'm';
  return null;
}

const suffixTriad = (suffix: string) => triad(qualities.find((q) => q.suffix === suffix)!);

/**
 * The Chords that usually follow a Chord in a Key, best first. A dominant
 * Chord a fifth above one of the Key's own but the tonic is its V, and
 * resolves to it: E7 in G, the V of Am, goes to Am. One of the Key's own
 * Chords, or one it borrows, gets its functional moves, then the V of each
 * Chord it moves to, to lead there. Any other Chord has none.
 */
export function suggestAfter(key: Key, picked: Chord): Suggestion[] {
  const chords = keyChords(key);
  const pickedTriad = triad(picked.quality);
  const has = (n: number) => picked.quality.tones.some((t) => t.semitones === n);
  const resolvesTo =
    pickedTriad === '' && !has(11)
      ? chords.find((c) => c.kind === 'secondary' && c.root === picked.root)?.of
      : undefined;
  const resolve = (to: KeyChord) => [{ ...suggestion(to), reason: `Resolves ${picked.name} as V of ${to.chord}` }];
  // A dominant seventh is the V of the Chord a fifth below, even on one of the Key's degrees (G7 in G).
  if (resolvesTo && has(10)) return resolve(resolvesTo);

  const own = chords.find(
    (c) =>
      c.kind !== 'secondary' &&
      c.root === picked.root &&
      (pickedTriad === null || suffixTriad(c.suffix) === pickedTriad),
  );
  if (!own) return resolvesTo ? resolve(resolvesTo) : [];

  const moves = ((key.minor ? minorMoves : majorMoves)[own.numeral] ?? []).flatMap(([numeral, reason]) => {
    const to = chords.find((c) => c.kind !== 'secondary' && c.numeral === numeral);
    return to ? [{ ...suggestion(to), reason }] : [];
  });
  const leads = moves.flatMap((m) =>
    chords.filter((c) => c.kind === 'secondary' && c.numeral === 'V/' + m.numeral && c.chord !== picked.name),
  );
  return [...moves, ...leads.map(suggestion)];
}
