import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { lyricsLanguage, readLanguageData } from './lyricsLanguage';
import { lookUpRhymes } from './rhymeLookup';

const served = (code: string) =>
  readLanguageData(
    code,
    gunzipSync(readFileSync(new URL(`../../../internal/languagedata/${code}.txt.gz`, import.meta.url))).toString(
      'utf8',
    ),
  );
const english = served('en');
const portuguese = served('pt');
const both = lyricsLanguage([english, portuguese]);

describe('lookUpRhymes', () => {
  it("starts at the Language the word is read in, whatever the Song's order", () => {
    expect(lookUpRhymes(both, 'night', ['pt', 'en']).language).toBe('en');
    expect(lookUpRhymes(both, 'coração', ['en', 'pt']).language).toBe('pt');
    expect(lookUpRhymes(both, 'coração', ['en', 'pt']).rhymes?.perfect).toContainEqual({ word: 'canção', count: 2 });
  });

  it("gives Rhymes in another of the Song's Languages when it's picked", () => {
    const lookup = lookUpRhymes(both, 'mar', ['pt', 'en'], 'en');
    expect(lookup.language).toBe('en');
    expect(lookup.rhymes?.perfect.map((r) => r.word)).toContain('car');
  });

  it("ignores a Language picked that the Song isn't sung in", () => {
    expect(lookUpRhymes(both, 'coração', ['pt'], 'en').language).toBe('pt');
  });

  it('is loading while the dictionaries set up are on their way', () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'coração', ['en', 'pt'], null, true);
    expect(lookup).toMatchObject({ word: 'coração', rhymes: null, loading: true });
  });

  it("asks to set up the Song's other Languages for a word in none of the set-up dictionaries", () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'saudade', ['en', 'pt']);
    expect(lookup).toMatchObject({ language: null, rhymes: null, loading: false, notIn: ['en'], toSetUp: ['pt'] });
  });

  it('reads a word in a set-up dictionary though others are not set up', () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'night', ['pt', 'en']);
    expect(lookup).toMatchObject({ language: 'en', toSetUp: [], notIn: [] });
    expect(lookup.rhymes?.perfect.map((r) => r.word)).toContain('tonight');
  });

  it("asks to set up a Language picked in the switch that isn't", () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'night', ['en', 'pt'], 'pt');
    expect(lookup).toMatchObject({ language: 'pt', rhymes: null, toSetUp: ['pt'], notIn: [] });
  });

  it("asks to set up the Song's Languages when none is, word or not", () => {
    const none = lyricsLanguage([]);
    expect(lookUpRhymes(none, 'night', ['en', 'pt'])).toMatchObject({ rhymes: null, toSetUp: ['en', 'pt'], notIn: [] });
    expect(lookUpRhymes(none, null, ['en'])).toMatchObject({ word: null, toSetUp: ['en'] });
  });

  it("guesses an unknown word's Rhymes from spelling rules once every Language is set up", () => {
    const lookup = lookUpRhymes(both, 'saudadezinha', ['en', 'pt']);
    expect(lookup.language).toBe('pt');
    expect(lookup.rhymes?.guess).toBe(true);
  });

  it("has no Rhymes for a word the Language can't read, without loading", () => {
    expect(lookUpRhymes(both, 'skrrt', ['en'])).toEqual({
      word: 'skrrt',
      language: 'en',
      rhymes: null,
      loading: false,
      toSetUp: [],
      notIn: [],
    });
  });

  it('looks up nothing without a word', () => {
    expect(lookUpRhymes(both, null, ['en'])).toEqual({
      word: null,
      language: null,
      rhymes: null,
      loading: false,
      toSetUp: [],
      notIn: [],
    });
  });
});
