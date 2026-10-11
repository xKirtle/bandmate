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

  it("is loading until the Language's data is in", () => {
    const lookup = lookUpRhymes(lyricsLanguage([english]), 'coração', ['en', 'pt']);
    expect(lookup).toEqual({ word: 'coração', language: 'pt', rhymes: null, loading: true });
    expect(lookUpRhymes(lyricsLanguage([]), 'night', ['en']).loading).toBe(true);
  });

  it("has no Rhymes for a word the Language can't read, without loading", () => {
    expect(lookUpRhymes(both, 'skrrt', ['en'])).toEqual({
      word: 'skrrt',
      language: 'en',
      rhymes: null,
      loading: false,
    });
  });

  it('looks up nothing without a word', () => {
    expect(lookUpRhymes(both, null, ['en'])).toEqual({ word: null, language: null, rhymes: null, loading: false });
  });
});
