// The lyrics language work: a word's Rhymes, each with its Syllable Count,
// the Language a word is read in, and the word at the caret, worked out in
// the browser from the dictionary of each Language downloaded to this
// device, which the binary serves (ADR 0018). A Line's Chords aren't words,
// a hyphenated word is read as its parts, and each word is read in the
// first of the Song's Languages, in the Song's order, whose downloaded
// dictionary has it. Every Language's dictionary is a pronouncing one, so
// Rhymes match how words sound, never how they're spelt (ADR 0022): a word
// none of them has gets no Rhymes.

/** A Language's data, read from what the binary serves for it. */
export interface LanguageData {
  /** The Language's BCP 47 code, e.g. "en" or "pt-PT". */
  code: string;
  /** Its pronunciations of each word it knows, in lower case, the first the usual one. */
  pronunciations: ReadonlyMap<string, readonly string[][]>;
  /** How common each word it ranks is, 0 the most common. Those it doesn't rank are rarer than all. */
  ranks: ReadonlyMap<string, number>;
}

/** A word suggested as a Rhyme, and its Syllable Count. */
export interface Rhyme {
  word: string;
  count: number;
}

/** A word's Rhymes: perfect ones, then near ones, each the most common first. */
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
 * Reads a Language's data as served: its dictionary, one pronunciation a
 * line, "hello HH AH0 L OW1", then a "#ranks" line, then its ranks: words,
 * the most common first, one a line. Data kept before the ranks shipped has
 * none.
 */
export function readLanguageData(code: string, text: string): LanguageData {
  const [dictionary, rankText = ''] = text.split(/^#ranks$/m, 2);
  const ranks = new Map<string, number>();
  for (const line of rankText.split('\n')) {
    const word = line.trim();
    if (word && !ranks.has(word)) ranks.set(word, ranks.size);
  }
  const pronunciations = new Map<string, string[][]>();
  for (const line of dictionary.split('\n')) {
    const [word, ...phones] = line.trim().split(/\s+/);
    if (!word || phones.length === 0) continue;
    const known = pronunciations.get(word);
    if (known) known.push(phones);
    else pronunciations.set(word, [phones]);
  }
  return { code, pronunciations, ranks };
}

/**
 * The lyrics language work over the Languages whose dictionaries are
 * downloaded to this device: a Language of a Song not among them is never
 * guessed at, and suggests no Rhymes.
 */
export type LyricsLanguage = ReturnType<typeof lyricsLanguage>;

export function lyricsLanguage(dictionaries: readonly LanguageData[]) {
  const byCode = new Map(dictionaries.map((d) => [d.code, d]));

  /** Whether a Language's dictionary is downloaded and has a word, as it's looked up. */
  function has(code: string, word: string): boolean {
    const known = byCode.get(code)?.pronunciations;
    return !!known && (known.has(word) || known.has(trimApostrophes(word)));
  }

  return {
    /** Whether a Language's dictionary is downloaded, so it can suggest Rhymes. */
    isSetUp(language: string): boolean {
      return byCode.has(language);
    },

    /**
     * The Language a word of a Song sung in `languages` is read in: the
     * first of them, in the Song's order, whose dictionary has it. A word
     * in none, once every one of them is downloaded, is an unknown word,
     * read in the first. Null while the word is in none and some aren't
     * downloaded, as those are never guessed at.
     */
    languageOf(word: string, languages: readonly string[]): string | null {
      const asked = normalWord(word);
      const known = languages.find((code) => has(code, asked));
      if (known) return known;
      if (languages.length === 0 || !languages.every((code) => byCode.has(code))) return null;
      return languages[0];
    },

    /**
     * A word's Rhymes in a Language: perfect ones sound the same from the
     * word's last stressed vowel to its end, near ones only have the same
     * vowels from there. They're suggested from the words its dictionary
     * has. Null for a word it doesn't have, and when it isn't downloaded.
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
      const order = inOrder(data.ranks, count, ending);
      return { perfect: order(perfect), near: order(near) };
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

// A Chord as the server reads one in a Line's text (internal/song/chords.go).
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
interface Sound {
  count: number;
  ending: Ending;
}

/** How a Language says a word, by its usual pronunciation. Null for one its dictionary doesn't have. */
function soundOf(data: LanguageData, word: string): Sound | null {
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
 * words its dictionary knows. Only words of letters are suggested, not
 * possessives or abbreviations.
 */
function rhymeIndex(data: LanguageData): RhymeIndex {
  let index = rhymeIndexes.get(data);
  if (index) return index;
  index = { bySounds: new Map(), byVowels: new Map() };
  for (const word of data.pronunciations.keys()) {
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
 * Rhymes in order: the most common first, and those the Language doesn't
 * rank after all it does. Among equals, nearest the word in syllables
 * first, then nearest in how many sounds they end with, so a near Rhyme's
 * ending is about as long as the word's, then fewer syllables before more,
 * then alphabetically.
 */
function inOrder(ranks: ReadonlyMap<string, number>, count: number, ending: Ending) {
  const rank = (c: Candidate) => ranks.get(c.rhyme.word) ?? ranks.size;
  const apart = (c: Candidate) => Math.abs(c.rhyme.count - count);
  const lengthApart = (c: Candidate) => Math.abs(c.ending.length - ending.length);
  return (candidates: Candidate[]): Rhyme[] =>
    candidates
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          apart(a) - apart(b) ||
          lengthApart(a) - lengthApart(b) ||
          a.rhyme.count - b.rhyme.count ||
          a.rhyme.word.localeCompare(b.rhyme.word),
      )
      .map((c) => c.rhyme);
}
