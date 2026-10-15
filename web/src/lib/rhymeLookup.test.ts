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
const portuguese = served('pt-PT');
const both = lyricsLanguage([english, portuguese]);

describe('lookUpRhymes', () => {
  it("starts at the Language the word is read in, whatever the Song's order", () => {
    expect(lookUpRhymes(both, 'night', ['pt-PT', 'en']).language).toBe('en');
    expect(lookUpRhymes(both, 'coração', ['en', 'pt-PT']).language).toBe('pt-PT');
    expect(lookUpRhymes(both, 'coração', ['en', 'pt-PT']).rhymes?.perfect).toContainEqual({ word: 'canção', count: 2 });
  });

  it("gives Rhymes in another of the Song's Languages when it's picked", () => {
    const lookup = lookUpRhymes(both, 'mar', ['pt-PT', 'en'], 'en');
    expect(lookup.language).toBe('en');
    expect(lookup.rhymes?.perfect.map((r) => r.word)).toContain('car');
  });

  it("ignores a Language picked that the Song isn't sung in", () => {
    expect(lookUpRhymes(both, 'coração', ['pt-PT'], 'en').language).toBe('pt-PT');
  });

  it('is loading while the downloaded dictionaries are on their way', () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'coração', ['en', 'pt-PT'], null, true);
    expect(lookup).toMatchObject({ word: 'coração', rhymes: null, loading: true });
  });

  it("asks to download the Song's other Languages for a word in none of the downloaded dictionaries", () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'saudade', ['en', 'pt-PT']);
    expect(lookup).toMatchObject({ language: null, rhymes: null, loading: false, notIn: ['en'], toSetUp: ['pt-PT'] });
  });

  it('reads a word in a downloaded dictionary though others are not downloaded', () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'night', ['pt-PT', 'en']);
    expect(lookup).toMatchObject({ language: 'en', toSetUp: [], notIn: [] });
    expect(lookup.rhymes?.perfect.map((r) => r.word)).toContain('tonight');
  });

  it("asks to download a Language picked in the switch that isn't", () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'night', ['en', 'pt-PT'], 'pt-PT');
    expect(lookup).toMatchObject({ language: 'pt-PT', rhymes: null, toSetUp: ['pt-PT'], notIn: [] });
  });

  it("asks to download the Song's Languages when none is, word or not", () => {
    const none = lyricsLanguage([]);
    expect(lookUpRhymes(none, 'night', ['en', 'pt-PT'])).toMatchObject({
      rhymes: null,
      toSetUp: ['en', 'pt-PT'],
      notIn: [],
    });
    expect(lookUpRhymes(none, null, ['en'])).toMatchObject({ word: null, toSetUp: ['en'] });
  });

  it("has no Rhymes for a word in none of the Song's dictionaries, read in its first Language, once every one is downloaded", () => {
    expect(lookUpRhymes(both, 'saudadezinha', ['en', 'pt-PT'])).toMatchObject({
      language: 'en',
      rhymes: null,
      toSetUp: [],
      notIn: [],
    });
    expect(lookUpRhymes(both, 'saudadezinha', ['pt-PT', 'en'])).toMatchObject({ language: 'pt-PT', rhymes: null });
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
