// The lyrics language work: a Line's Syllable Count, a word's Rhymes and
// the word at the caret, worked out in the browser from each Language's
// data, which the binary serves (ADR 0018).
// A Line's Chords are left out, a hyphenated word counts as its parts, and
// each word is read in the first of the Song's Languages that knows it; one
// that none knows, or a number in digits, is guessed from its spelling in
// the Song's first Language, and the count marked as an estimate.

/** A Language's data, read from what the binary serves for it. */
export interface LanguageData {
  /** The Language's ISO 639-1 code, e.g. "en". */
  code: string;
  /** A dictionary Language's pronunciations of each word it knows, in lower case, the first the usual one. */
  pronunciations: ReadonlyMap<string, readonly string[][]>;
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
export type CaretListener = (at: { text: string; caret: number } | null) => void;

/** A Song's Syllable Counts: a Line's from its text as written, or null when it gets none. */
export type SyllableCounter = (text: string) => SyllableCount | null;

/** Reads a dictionary Language's data as served: one pronunciation a line, "hello HH AH0 L OW1". */
export function readLanguageData(code: string, text: string): LanguageData {
  const pronunciations = new Map<string, string[][]>();
  for (const line of text.split('\n')) {
    const [word, ...phones] = line.trim().split(/\s+/);
    if (!word || phones.length === 0) continue;
    const known = pronunciations.get(word);
    if (known) known.push(phones);
    else pronunciations.set(word, [phones]);
  }
  return { code, pronunciations };
}

/** What a Language does with a word no Language of the Song knows. */
interface Guesser {
  /** A word's syllables guessed from its letters. */
  letters: (word: string) => number;
  /** A number in digits as it's read aloud, in words. */
  number: (digits: string) => string[];
}

const guessers: Record<string, Guesser> = {
  en: { letters: guessEnglish, number: englishNumber },
};

/**
 * The lyrics language work over the Languages whose data has been read: a
 * Language of a Song not among them reads no words, and a Song none of whose
 * Languages is among them gets no counts.
 */
export function lyricsLanguage(data: readonly LanguageData[]) {
  const byCode = new Map(data.map((d) => [d.code, d]));

  /** A word's syllables from the first of the Languages that knows it, or null. */
  function lookUp(word: string, languages: readonly LanguageData[]): number | null {
    for (const language of languages) {
      const known = language.pronunciations.get(word) ?? language.pronunciations.get(trimApostrophes(word));
      if (known) return vowels(known[0]);
    }
    return null;
  }

  return {
    /**
     * A Line's Syllable Count, from its text as written with Chords inline,
     * in a Song sung in `languages`, in order. Null for a Chord Line, a
     * blank Line or one with no words, and until one of the Languages has
     * its data.
     */
    syllableCount(text: string, languages: readonly string[]): SyllableCount | null {
      const loaded = languages.flatMap((code) => byCode.get(code) ?? []);
      // Every Language Bandmate has data for has its rules for guessing; English's stand in for one that has none yet.
      const first = guessers[languages[0]] ?? guessers.en;
      if (loaded.length === 0) return null;
      const words = wordsOf(lyricsOf(text).lyrics);
      if (words.length === 0) return null;
      let count = 0;
      let estimate = false;
      for (const { word } of words) {
        const known = /\d/.test(word) ? null : lookUp(word, loaded);
        if (known !== null) {
          count += known;
          continue;
        }
        estimate = true;
        count += guess(word, first, (w) => lookUp(w, loaded));
      }
      return { count, estimate };
    },

    /**
     * A word's Rhymes in a Language: perfect ones sound the same from the
     * word's last stressed vowel to its end, near ones only have the same
     * vowels from there. Null for a word the Language doesn't know, and
     * until it has its data.
     */
    rhymes(word: string, language: string): Rhymes | null {
      const data = byCode.get(language);
      const own = trimApostrophes(word.toLowerCase().replace(/[’‘]/g, "'"));
      const phones = data?.pronunciations.get(own)?.[0];
      const ending = phones && endingOf(phones);
      if (!data || !phones || !ending) return null;
      const index = rhymeIndex(data);
      const count = vowels(phones);
      const perfect = (index.bySounds.get(ending.sounds) ?? []).filter((c) => c.rhyme.word !== own);
      const near = (index.byVowels.get(ending.vowels) ?? []).filter(
        (c) => c.ending.sounds !== ending.sounds && c.rhyme.word !== own,
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

/** A word no Language knows, guessed: its numbers read aloud, its letters by the Language's rules. */
function guess(word: string, guesser: Guesser, lookUp: (word: string) => number | null): number {
  let count = 0;
  for (const run of word.match(/\d+|[^\d]+/g) ?? []) {
    if (/\d/.test(run)) {
      for (const spoken of guesser.number(run)) count += lookUp(spoken) ?? guesser.letters(spoken);
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

/** A word of a Line, in lower case, and where it starts and ends in the Line. */
interface Word {
  word: string;
  start: number;
  end: number;
}

/** A Line's words: a hyphen, a dash or any other mark between letters parts them. */
function wordsOf(lyrics: string): Word[] {
  const words: Word[] = [];
  for (const match of lyrics.replace(/[’‘]/g, "'").matchAll(/[\p{L}\p{M}\p{N}']+/gu)) {
    const word = trimApostrophes(match[0].toLowerCase());
    if (/[\p{L}\p{N}]/u.test(word)) words.push({ word, start: match.index, end: match.index + match[0].length });
  }
  return words;
}

/** How a pronunciation ends, from its last stressed vowel. */
interface Ending {
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

/** A word that may be suggested as a Rhyme, and how it ends. */
interface Candidate {
  rhyme: Rhyme;
  ending: Ending;
}

/** A dictionary Language's words by how they end, to find Rhymes among. */
interface RhymeIndex {
  bySounds: Map<string, Candidate[]>;
  byVowels: Map<string, Candidate[]>;
}

const rhymeIndexes = new WeakMap<LanguageData, RhymeIndex>();

/**
 * A Language's Rhyme index, built the first time it's asked for. Only words
 * of letters are suggested, not possessives or abbreviations, each by its
 * usual pronunciation.
 */
function rhymeIndex(data: LanguageData): RhymeIndex {
  let index = rhymeIndexes.get(data);
  if (index) return index;
  index = { bySounds: new Map(), byVowels: new Map() };
  for (const [word, [phones]] of data.pronunciations) {
    if (!/^\p{L}+$/u.test(word)) continue;
    const ending = endingOf(phones);
    if (!ending) continue;
    const candidate = { rhyme: { word, count: vowels(phones) }, ending };
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
  const longer = (c: Candidate) => Math.abs(c.ending.length - ending.length);
  return candidates
    .sort(
      (a, b) =>
        apart(a) - apart(b) ||
        longer(a) - longer(b) ||
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
