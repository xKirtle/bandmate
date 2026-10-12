// The lyrics language work: a word's Rhymes, each with its Syllable Count,
// the Language a word is read in, and the word at the caret, worked out in
// the browser from each Language's data, which the binary serves (ADR 0018).
// A Line's Chords aren't words, a hyphenated word is read as its parts, and
// each word is read by the first of the Song's dictionary Languages that
// knows it, in the Song's order, or else by the first of its spelling-rules
// Languages, which reads any word with a vowel.

import { portugueseSound } from './portuguese';

/** A Language's data, read from what the binary serves for it. */
export interface LanguageData {
  /** The Language's ISO 639-1 code, e.g. "en". */
  code: string;
  /** A dictionary Language's pronunciations of each word it knows, in lower case, the first the usual one. */
  pronunciations: ReadonlyMap<string, readonly string[][]>;
  /** A spelling-rules Language's words, in lower case, to suggest Rhymes from. */
  words: readonly string[];
}

/** A word suggested as a Rhyme, and its Syllable Count. */
export interface Rhyme {
  word: string;
  count: number;
}

/** A word's Rhymes: perfect ones, then near ones, each nearest the word in syllables first. */
export interface Rhymes {
  perfect: Rhyme[];
  near: Rhyme[];
}

/**
 * Hears where the caret is in an Alternate's text box, `caret` characters
 * into its text, to find the word at it; null once no text box has focus.
 */
export type CaretListener = (at: CaretAt | null) => void;

/** Where the caret is in a text box: `caret` characters into its `text`. */
export interface CaretAt {
  text: string;
  caret: number;
}

/**
 * Reads a Language's data as served: a dictionary Language's, one
 * pronunciation a line, "hello HH AH0 L OW1"; a spelling-rules Language's,
 * one word a line.
 */
export function readLanguageData(code: string, text: string): LanguageData {
  const pronunciations = new Map<string, string[][]>();
  if (isSpellingRules(code)) {
    const words = text
      .split('\n')
      .map((line) => line.trim())
      .filter((word) => word !== '');
    return { code, pronunciations, words };
  }
  for (const line of text.split('\n')) {
    const [word, ...phones] = line.trim().split(/\s+/);
    if (!word || phones.length === 0) continue;
    const known = pronunciations.get(word);
    if (known) known.push(phones);
    else pronunciations.set(word, [phones]);
  }
  return { code, pronunciations, words: [] };
}

/**
 * The spelling-rules Languages' rules, which read a word from how it's
 * written: its syllables, and how it ends with them, to find its Rhymes.
 * Null for one they can't read.
 */
const spellingRules: Record<string, (word: string) => Sound | null> = {
  pt: portugueseSound,
};

function isSpellingRules(code: string): boolean {
  return code in spellingRules;
}

/**
 * Whether a Language's words are read from its data, so not until it has
 * it: a dictionary Language's are. A spelling-rules Language's data is only
 * to suggest Rhymes from.
 */
function readsFromData(code: string): boolean {
  return !isSpellingRules(code);
}

/**
 * The lyrics language work over the Languages whose data has been read: a
 * Language of a Song not among them reads no words, and suggests no Rhymes.
 */
export type LyricsLanguage = ReturnType<typeof lyricsLanguage>;

export function lyricsLanguage(data: readonly LanguageData[]) {
  const byCode = new Map(data.map((d) => [d.code, d]));

  /**
   * The Language a word is read in: the first of these Languages'
   * dictionaries that knows it, in order, or else the first of their
   * spelling rules. Null when none of them reads it.
   */
  function readWord(word: string, languages: readonly string[]): string | null {
    for (const code of languages) {
      const pronunciations = byCode.get(code)?.pronunciations;
      if (pronunciations?.has(word) || pronunciations?.has(trimApostrophes(word))) return code;
    }
    const rules = languages.find(isSpellingRules);
    return rules && spellingRules[rules](word) ? rules : null;
  }

  /** Whether these Languages can read words: each that reads from its data has it. */
  const canRead = (languages: readonly string[]) =>
    languages.length > 0 && languages.every((code) => !readsFromData(code) || byCode.has(code));

  return {
    /** Whether a Language's data has been read, so it can suggest Rhymes. */
    hasData(language: string): boolean {
      return byCode.has(language);
    },

    /**
     * The Language a word of a Song sung in `languages` is read in: the
     * first of the Song's dictionary Languages that knows it, or else its
     * first spelling-rules Language, or, for a word neither reads, its first
     * Language. Null until each of its dictionary Languages has its data.
     */
    languageOf(word: string, languages: readonly string[]): string | null {
      if (!canRead(languages)) return null;
      return readWord(normalWord(word), languages) ?? languages[0];
    },

    /**
     * A word's Rhymes in a Language: perfect ones sound the same from the
     * word's last stressed vowel to its end, near ones only have the same
     * vowels from there. Null for a word the Language can't read, and until
     * it has its data. A dictionary Language reads the words it knows and
     * suggests from them; a spelling-rules Language reads any word by its
     * rules and suggests from its word list.
     */
    rhymes(word: string, language: string): Rhymes | null {
      const data = byCode.get(language);
      const asked = normalWord(word);
      const sound = data && soundOf(data, asked);
      if (!data || !sound) return null;
      const { count, ending } = sound;
      const index = rhymeIndex(data);
      const perfect = (index.bySounds.get(ending.sounds) ?? []).filter((c) => c.rhyme.word !== asked);
      const near = (index.byVowels.get(ending.vowels) ?? []).filter(
        (c) => c.ending.sounds !== ending.sounds && c.rhyme.word !== asked,
      );
      return { perfect: byCloseness(perfect, count, ending), near: byCloseness(near, count, ending) };
    },

    /**
     * The word at the caret, `caret` characters into `text`, on the Line
     * it's on: the word it's in or touches, or else the last word before it,
     * so the Line's last word once the caret is past it. Chords aren't words.
     * Null when the Line has no word up to the caret.
     */
    wordAt(text: string, caret: number): string | null {
      const start = text.lastIndexOf('\n', caret - 1) + 1;
      const end = text.indexOf('\n', caret);
      const line = text.slice(start, end < 0 ? undefined : end);
      const { lyrics, place } = lyricsOf(line, caret - start);
      let before: string | null = null;
      for (const word of wordsOf(lyrics)) {
        if (word.start > place) break;
        before = word.word;
      }
      return before;
    },
  };
}

/** How many vowels, so syllables, a pronunciation has: its phones that carry a stress. */
function vowels(phones: readonly string[]): number {
  return phones.filter((p) => /\d$/.test(p)).length;
}

/** A word as it's looked up: its accents composed, in lower case, its curly apostrophes straight, none at either end. */
function normalWord(word: string): string {
  return trimApostrophes(word.normalize('NFC').toLowerCase().replace(/[’‘]/g, "'"));
}

function trimApostrophes(word: string): string {
  return word.replace(/^'+|'+$/g, '');
}

// A Chord as the server reads one in a Line's text (internal/lyricsheet/chords.go).
const chordNote = '[A-G][#b♯♭]?';
const chordToken = '(?:maj|min|ma|mi|dim|aug|sus|add|alt|m|M|\\+|-|°|ø|Δ|6/9|[#b♯♭]?[0-9]+)';
const chordName = new RegExp(`^${chordNote}(?:${chordToken}|\\((?:${chordToken}|,)+\\))*(?:/${chordNote})?$`, 'u');

/**
 * A Line's text without its Chords, and where a place in the text, such as
 * the caret, is in that: inside a Chord is just before it. Bracketed text
 * that isn't a Chord stays, as on the server.
 */
function lyricsOf(text: string, place = 0): { lyrics: string; place: number } {
  let moved = place;
  const lyrics = text.replace(/\[([^\]]*)\]/g, (bracketed, name: string, at: number) => {
    if (!chordName.test(name)) return bracketed;
    if (at < place) moved -= Math.min(bracketed.length, place - at);
    return '';
  });
  return { lyrics, place: moved };
}

/** A word of a Line, as it's looked up, and where it starts in the Line. */
interface Word {
  word: string;
  start: number;
}

/** A Line's words: a hyphen, a dash or any other mark between letters parts them. */
function wordsOf(lyrics: string): Word[] {
  const words: Word[] = [];
  for (const match of lyrics.matchAll(/[\p{L}\p{M}\p{N}'’‘]+/gu)) {
    const word = normalWord(match[0]);
    if (/[\p{L}\p{N}]/u.test(word)) words.push({ word, start: match.index });
  }
  return words;
}

/** How a word ends, from its last stressed vowel, as its Rhymes are found. */
export interface Ending {
  /** Its sounds, stress aside. */
  sounds: string;
  /** Only its vowels. */
  vowels: string;
  /** How many sounds it has. */
  length: number;
}

function endingOf(phones: readonly string[]): Ending | null {
  const lastWith = (stress: RegExp) => phones.reduce((at, p, i) => (stress.test(p) ? i : at), -1);
  let from = lastWith(/[12]$/);
  // A word with no stressed vowel, like "the" as it's often said, ends from its last vowel.
  if (from < 0) from = lastWith(/\d$/);
  if (from < 0) return null;
  const ending = phones.slice(from);
  const unstressed = (p: string) => p.replace(/\d$/, '');
  return {
    sounds: ending.map(unstressed).join(' '),
    vowels: ending
      .filter((p) => /\d$/.test(p))
      .map(unstressed)
      .join(' '),
    length: ending.length,
  };
}

/** How a word sounds, as far as its Rhymes go: its syllables, and how it ends. */
export interface Sound {
  count: number;
  ending: Ending;
}

/**
 * How a Language says a word: by its usual pronunciation in a dictionary
 * Language, or by a spelling-rules one's rules. Null for one it can't read.
 */
function soundOf(data: LanguageData, word: string): Sound | null {
  const rules = spellingRules[data.code];
  if (rules) return rules(word);
  const phones = data.pronunciations.get(word)?.[0];
  const ending = phones && endingOf(phones);
  return phones && ending ? { count: vowels(phones), ending } : null;
}

/** A word that may be suggested as a Rhyme, and how it ends. */
interface Candidate {
  rhyme: Rhyme;
  ending: Ending;
}

/** A Language's words by how they end, to find Rhymes among. */
interface RhymeIndex {
  bySounds: Map<string, Candidate[]>;
  byVowels: Map<string, Candidate[]>;
}

const rhymeIndexes = new WeakMap<LanguageData, RhymeIndex>();

/**
 * A Language's Rhyme index, built the first time it's asked for, from the
 * words its dictionary knows or its word list. Only words of letters are
 * suggested, not possessives or abbreviations.
 */
function rhymeIndex(data: LanguageData): RhymeIndex {
  let index = rhymeIndexes.get(data);
  if (index) return index;
  index = { bySounds: new Map(), byVowels: new Map() };
  const words = isSpellingRules(data.code) ? data.words : data.pronunciations.keys();
  for (const word of words) {
    if (!/^\p{L}+$/u.test(word)) continue;
    const sound = soundOf(data, word);
    if (!sound) continue;
    const { count, ending } = sound;
    const candidate = { rhyme: { word, count }, ending };
    for (const [map, key] of [
      [index.bySounds, ending.sounds],
      [index.byVowels, ending.vowels],
    ] as const) {
      const list = map.get(key);
      if (list) list.push(candidate);
      else map.set(key, [candidate]);
    }
  }
  rhymeIndexes.set(data, index);
  return index;
}

/**
 * Rhymes in order: nearest the word in syllables first, then nearest in how
 * many sounds they end with, so a near Rhyme's ending is about as long as
 * the word's, then fewer syllables before more, then alphabetically.
 */
function byCloseness(candidates: Candidate[], count: number, ending: Ending): Rhyme[] {
  const apart = (c: Candidate) => Math.abs(c.rhyme.count - count);
  const lengthApart = (c: Candidate) => Math.abs(c.ending.length - ending.length);
  return candidates
    .sort(
      (a, b) =>
        apart(a) - apart(b) ||
        lengthApart(a) - lengthApart(b) ||
        a.rhyme.count - b.rhyme.count ||
        a.rhyme.word.localeCompare(b.rhyme.word),
    )
    .map((c) => c.rhyme);
}
