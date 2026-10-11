// The lyrics language work: a Line's Syllable Count, worked out in the
// browser from each Language's data, which the binary serves (ADR 0018).
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
      const first = guessers[languages[0]] ?? guessers.en;
      if (loaded.length === 0) return null;
      const words = wordsOf(lyricsOf(text));
      if (words.length === 0) return null;
      let count = 0;
      let estimate = false;
      for (const word of words) {
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

/** A Line's text without its Chords; bracketed text that isn't a Chord stays, as on the server. */
function lyricsOf(text: string): string {
  return text.replace(/\[([^\]]*)\]/g, (bracketed, name: string) => (chordName.test(name) ? '' : bracketed));
}

/** A Line's words, in lower case: a hyphen, a dash or any other mark between letters parts them. */
function wordsOf(lyrics: string): string[] {
  return (
    lyrics
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[\p{L}\p{M}\p{N}']+/gu) ?? []
  )
    .map(trimApostrophes)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
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
