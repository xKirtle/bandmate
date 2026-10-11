import { describe, expect, it } from 'vitest';
import { languageChoices, languageName, languages, languagesLabel, moveLanguage, pickLanguage } from './languages';

const known = [
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'es', name: 'Spanish' },
];

describe('languages', () => {
  it('offers English, the only Language Bandmate has data for so far', () => {
    expect(languages).toEqual([{ code: 'en', name: 'English' }]);
  });
});

describe('languageName', () => {
  it('names a Language Bandmate has data for', () => {
    expect(languageName('en')).toBe('English');
  });

  it('shows a code it has no name for as it is', () => {
    expect(languageName('xx')).toBe('xx');
  });
});

describe('languagesLabel', () => {
  it("names a Song's Languages in their order", () => {
    expect(languagesLabel(['pt', 'en'], known)).toBe('Portuguese, English');
  });
});

describe('languageChoices', () => {
  it('lists the Languages picked first, in their order, then the rest as Bandmate lists them', () => {
    expect(languageChoices(['es', 'en'], known)).toEqual([
      { code: 'es', name: 'Spanish', picked: true },
      { code: 'en', name: 'English', picked: true },
      { code: 'pt', name: 'Portuguese', picked: false },
    ]);
  });

  it('leaves out a Language picked that Bandmate has no data for', () => {
    expect(languageChoices(['xx', 'en'], known).map((c) => c.code)).toEqual(['en', 'pt', 'es']);
  });
});

describe('pickLanguage', () => {
  it('adds a Language ticked after those already picked', () => {
    expect(pickLanguage(['pt'], 'en', true)).toEqual(['pt', 'en']);
  });

  it('takes a Language unticked out, keeping the others in order', () => {
    expect(pickLanguage(['es', 'pt', 'en'], 'pt', false)).toEqual(['es', 'en']);
  });

  it('keeps the last Language picked, as a Song always has one', () => {
    expect(pickLanguage(['en'], 'en', false)).toEqual(['en']);
  });

  it('adds a Language already picked only once', () => {
    expect(pickLanguage(['en'], 'en', true)).toEqual(['en']);
  });
});

describe('moveLanguage', () => {
  it('moves a Language a place earlier or later', () => {
    expect(moveLanguage(['en', 'pt', 'es'], 'pt', -1)).toEqual(['pt', 'en', 'es']);
    expect(moveLanguage(['en', 'pt', 'es'], 'pt', 1)).toEqual(['en', 'es', 'pt']);
  });

  it('leaves the order as it is at either end', () => {
    expect(moveLanguage(['en', 'pt'], 'en', -1)).toEqual(['en', 'pt']);
    expect(moveLanguage(['en', 'pt'], 'pt', 1)).toEqual(['en', 'pt']);
  });
});
