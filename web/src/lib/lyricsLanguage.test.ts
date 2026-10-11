import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { lyricsLanguage, readLanguageData } from './lyricsLanguage';

// English as the binary serves it: the CMU Pronouncing Dictionary.
const english = readLanguageData(
  'en',
  gunzipSync(readFileSync(new URL('../../../internal/languagedata/en.txt.gz', import.meta.url))).toString('utf8'),
);
const lyrics = lyricsLanguage([english]);
const count = (line: string) => lyrics.syllableCount(line, ['en']);

describe('syllableCount', () => {
  it('counts a Line from the dictionary', () => {
    expect(count('Hello darkness my old friend')).toEqual({ count: 7, estimate: false });
    expect(count("I've come to talk with you again")).toEqual({ count: 8, estimate: false });
  });

  it('leaves Chords out of the count', () => {
    expect(count('[Am]Hello')).toEqual({ count: 2, estimate: false });
    expect(count('Hel[Am]lo dark[C]ness, my [G/B]old friend')).toEqual({ count: 7, estimate: false });
  });

  it('reads bracketed text that is not a Chord as words', () => {
    expect(count('[softly] hello')).toEqual({ count: 4, estimate: false });
  });

  it('gives Chord Lines and blank Lines no count', () => {
    expect(count('[Am] [C]  [G]')).toBeNull();
    expect(count('')).toBeNull();
    expect(count('   ')).toBeNull();
  });

  it('gives a Line with no words no count', () => {
    expect(count('...')).toBeNull();
  });

  it('counts a hyphenated word as its parts', () => {
    expect(count('ooh-ooh')).toEqual(count('ooh ooh'));
    expect(count('ooh-ooh')).toEqual({ count: 2, estimate: false });
  });

  it('ignores case and punctuation, and reads curly apostrophes', () => {
    expect(count('HELLO, world!')).toEqual({ count: 3, estimate: false });
    expect(count('Don’t stop')).toEqual({ count: 2, estimate: false });
  });

  it('guesses a word the dictionary lacks, and marks the count as an estimate', () => {
    expect(count('skrrt')).toEqual({ count: 1, estimate: true });
    expect(count('hello zorblaxing')).toEqual({ count: 5, estimate: true });
  });

  it('guesses a number written in digits as it is read', () => {
    expect(count('24 hours')).toEqual({ count: 5, estimate: true });
    expect(count('7')).toEqual({ count: 2, estimate: true });
    expect(count('1999')).toEqual({ count: 5, estimate: true });
  });

  it('counts nothing until a Language of the Song has its data', () => {
    expect(lyricsLanguage([]).syllableCount('Hello', ['en'])).toBeNull();
  });
});

describe('rhymes', () => {
  const rhymes = (word: string) => lyrics.rhymes(word, 'en');

  it('gives perfect Rhymes, each with its Syllable Count', () => {
    const { perfect } = rhymes('night')!;
    expect(perfect).toContainEqual({ word: 'bright', count: 1 });
    expect(perfect).toContainEqual({ word: 'tonight', count: 2 });
    expect(perfect).toContainEqual({ word: 'satellite', count: 3 });
  });

  it('gives near Rhymes, matching only the vowels, apart from the perfect ones', () => {
    const { perfect, near } = rhymes('night')!;
    expect(near).toContainEqual({ word: 'life', count: 1 });
    expect(near).toContainEqual({ word: 'surprise', count: 2 });
    expect(near.map((r) => r.word)).not.toContain('bright');
    expect(perfect.map((r) => r.word)).not.toContain('life');
  });

  it('matches from the last stressed vowel', () => {
    const { perfect, near } = rhymes('happy')!;
    expect(perfect).toContainEqual({ word: 'snappy', count: 2 });
    expect(perfect.map((r) => r.word)).not.toContain('sunny');
    expect(near).toContainEqual({ word: 'sadly', count: 2 });
  });

  it('lists the Rhymes nearest the word in syllables first', () => {
    const counts = rhymes('night')!.perfect.map((r) => r.count);
    expect(counts.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('leaves out the word itself', () => {
    const { perfect, near } = rhymes('Night')!;
    expect([...perfect, ...near].map((r) => r.word)).not.toContain('night');
  });

  it('gives no Rhymes for a word the Language does not know, or one without its data', () => {
    expect(rhymes('skrrt')).toBeNull();
    expect(lyricsLanguage([]).rhymes('night', 'en')).toBeNull();
  });
});

describe('wordAt', () => {
  const at = (marked: string) => lyrics.wordAt(marked.replace('|', ''), marked.indexOf('|'));

  it('gives the word at the caret', () => {
    expect(at('Hello dark|ness my old friend')).toBe('darkness');
    expect(at('Hello |darkness')).toBe('darkness');
    expect(at('Hello darkness|')).toBe('darkness');
  });

  it("gives the Line's last word when the caret is past it", () => {
    expect(at('Hello darkness, my old friend. |')).toBe('friend');
  });

  it('reads only the Line the caret is on', () => {
    expect(at('Hello darkness\nmy old fr|iend\nagain')).toBe('friend');
    expect(at('Hello darkness\n|')).toBeNull();
  });

  it('leaves Chords out, and parts hyphenated words', () => {
    expect(at('Hello [Am]|')).toBe('hello');
    expect(at('[Am]|')).toBeNull();
    expect(at('Hel[Am]lo dark[C]ness|')).toBe('darkness');
    expect(at('Hel[A|m]lo')).toBe('hello');
    expect(at('ooh-a|ah')).toBe('aah');
  });
});
