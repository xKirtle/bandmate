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
