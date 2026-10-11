// The lyrics language work: a Line's Syllable Count, a word's Rhymes and
// the word at the caret, worked out in the browser from each Language's
// data, which the binary serves (ADR 0018).
// A Line's Chords are left out, a hyphenated word counts as its parts, and
// each word is read by the first of the Song's dictionary Languages that
// knows it, in the Song's order, or else by the first of its spelling-rules
// Languages, which reads any word with a vowel. One that none of them reads,
// or a number in digits, is guessed in the Song's first Language, and the
// count marked as an estimate.

import { portugueseNumber, portugueseSound, portugueseSyllables } from './portuguese';

/** A Language's data, read from what the binary serves for it. */
export interface LanguageData {
  /** The Language's ISO 639-1 code, e.g. "en". */
  code: string;
  /** A dictionary Language's pronunciations of each word it knows, in lower case, the first the usual one. */
  pronunciations: ReadonlyMap<string, readonly string[][]>;
  /** A spelling-rules Language's words, in lower case, to suggest Rhymes from. */
  words: readonly string[];
}

/** A Line's Syllable Count, and whether a word in it was guessed. */
export interface SyllableCount {
  count: number;
  estimate: boolean;
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

/** A Song's Syllable Counts: a Line's from its text as written, or null when it gets none. */
export type SyllableCounter = (text: string) => SyllableCount | null;

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

/** What a Language does with a word no Language of the Song reads. */
interface Guesser {
  /** A word's syllables guessed from its letters. */
  letters: (word: string) => number;
  /** A number in digits as it's read aloud, in words. */
  number: (digits: string) => string[];
}

const guessers: Record<string, Guesser> = {
  en: { letters: guessEnglish, number: englishNumber },
  pt: { letters: (word) => portugueseSyllables(word) ?? 1, number: portugueseNumber },
};

/**
 * The spelling-rules Languages' rules, which read a word from how it's
 * written, or give null for one they can't read: its syllables, and how it
 * ends with them, to find its Rhymes.
 */
interface SpellingRules {
  syllables: (word: string) => number | null;
  sound: (word: string) => Sound | null;
}

const spellingRules: Record<string, SpellingRules> = {
  pt: { syllables: portugueseSyllables, sound: portugueseSound },
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
 * Language of a Song not among them reads no words, and a Song none of whose
 * Languages is among them gets no counts.
 */
export type LyricsLanguage = ReturnType<typeof lyricsLanguage>;

export function lyricsLanguage(data: readonly LanguageData[]) {
  const byCode = new Map(data.map((d) => [d.code, d]));

  /**
   * A word read by the first of these Languages' dictionaries that knows
   * it, in order, or else by the first of their spelling rules: the
   * Language that read it, and its syllables. Null when none of them reads it.
   */
  function readWord(word: string, languages: readonly string[]): { language: string; count: number } | null {
    for (const code of languages) {
      const pronunciations = byCode.get(code)?.pronunciations;
      const known = pronunciations?.get(word) ?? pronunciations?.get(trimApostrophes(word));
      if (known) return { language: code, count: vowels(known[0]) };
    }
    const rules = languages.find(isSpellingRules);
    const count = rules ? spellingRules[rules].syllables(word) : null;
    return rules && count !== null ? { language: rules, count } : null;
  }

  /** Whether these Languages can read words: each that reads from its data has it. */
  const canRead = (languages: readonly string[]) =>
    languages.length > 0 && languages.every((code) => !readsFromData(code) || byCode.has(code));

  return {
    /**
     * A Line's Syllable Count, from its text as written with Chords inline,
     * in a Song sung in `languages`, in order. Null for a Chord Line, a
     * blank Line or one with no words, and until each of its dictionary
     * Languages has its data, so no word is read by the wrong Language
     * meanwhile.
     */
    syllableCount(text: string, languages: readonly string[]): SyllableCount | null {
      if (!canRead(languages)) return null;
      const words = wordsOf(lyricsOf(text).lyrics);
      if (words.length === 0) return null;
      // Every Language Bandmate counts in has its rules for guessing; English's stand in for one that has none yet.
      const first = guessers[languages[0]] ?? guessers.en;
      // A number's words, as said in the first Language, are read in that Language.
      const countSaid = (word: string) => readWord(word, languages.slice(0, 1))?.count ?? first.letters(word);
      let count = 0;
      let estimate = false;
      for (const { word } of words) {
        const known = /\d/.test(word) ? null : readWord(word, languages);
        if (known !== null) {
          count += known.count;
          continue;
        }
        estimate = true;
        count += guess(word, first, countSaid);
      }
      return { count, estimate };
    },

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
      return readWord(normalWord(word), languages)?.language ?? languages[0];
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

/** A word no Language reads, guessed: its numbers read aloud, its letters by the Language's rules. */
function guess(word: string, guesser: Guesser, countSaid: (word: string) => number): number {
  let count = 0;
  for (const run of word.match(/\d+|[^\d]+/g) ?? []) {
    if (/\d/.test(run)) {
      for (const said of guesser.number(run)) count += countSaid(said);
    } else {
      count += guesser.letters(run);
    }
  }
  return count;
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
  if (rules) return rules.sound(word);
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

/** An English word's syllables guessed from its spelling: its groups of vowels, less a silent e. */
function guessEnglish(word: string): number {
  const w = word.toLowerCase().replace(/'/g, '');
  let groups = (w.match(/[aeiouy]+/g) ?? []).length;
  if (groups > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) groups--;
  else if (groups > 1 && /[^aeiouytd]ed$/.test(w)) groups--;
  else if (groups > 1 && /[^aeiouysxzhgc]es$/.test(w)) groups--;
  return Math.max(1, groups);
}

const ones = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowHundred(n: number): string[] {
  if (n < 20) return [ones[n]];
  return n % 10 === 0 ? [tens[Math.floor(n / 10)]] : [tens[Math.floor(n / 10)], ones[n % 10]];
}

function belowThousand(n: number): string[] {
  if (n < 100) return belowHundred(n);
  const rest = n % 100;
  return [ones[Math.floor(n / 100)], 'hundred', ...(rest ? ['and', ...belowHundred(rest)] : [])];
}

/** A number in English words: a year as a year ("nineteen ninety nine"), a long one digit by digit. */
function englishNumber(digits: string): string[] {
  const n = Number(digits);
  if (digits.length > 1 && digits.startsWith('0')) return [...digits].map((d) => ones[Number(d)]);
  if (n < 1000) return belowThousand(n);
  if (digits.length === 4) {
    const [high, low] = [Math.floor(n / 100), n % 100];
    if (high % 10 !== 0 && low !== 0) return [...belowHundred(high), ...(low < 10 ? ['oh'] : []), ...belowHundred(low)];
    if (high % 10 !== 0) return [...belowHundred(high), 'hundred'];
    const rest = n % 1000;
    return [ones[Math.floor(n / 1000)], 'thousand', ...(rest ? belowThousand(rest) : [])];
  }
  return [...digits].map((d) => ones[Number(d)]);
}
