import { describe, expect, it } from 'vitest';
import { languageChoices, languageName, languagesLabel, moveLanguage, pickLanguage } from './languages';

// The Languages as Bandmate lists them, with their download sizes.
const known = [
  { code: 'en', name: 'English', size: 1 },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', size: 1 },
  { code: 'es', name: 'Spanish', size: 1 },
];

describe('languageName', () => {
  it('names a Language Bandmate lists', () => {
    expect(languageName('es', known)).toBe('Spanish');
  });

  it('shows a code Bandmate has no name for, or has yet to list, as it is', () => {
    expect(languageName('xx', known)).toBe('xx');
    expect(languageName('en', [])).toBe('en');
  });
});

describe('languagesLabel', () => {
  it("names a Song's Languages in their order", () => {
    expect(languagesLabel(['pt-PT', 'en'], known)).toBe('Portuguese (Portugal), English');
  });
});

describe('languageChoices', () => {
  it('lists the Languages picked first, in their order, then the rest as Bandmate lists them', () => {
    expect(languageChoices(['es', 'en'], known)).toEqual([
      { code: 'es', name: 'Spanish', picked: true },
      { code: 'en', name: 'English', picked: true },
      { code: 'pt-PT', name: 'Portuguese (Portugal)', picked: false },
    ]);
  });

  it('leaves out a Language picked that Bandmate has no data for', () => {
    expect(languageChoices(['xx', 'en'], known).map((c) => c.code)).toEqual(['en', 'pt-PT', 'es']);
  });
});

describe('pickLanguage', () => {
  it('adds a Language ticked after those already picked', () => {
    expect(pickLanguage(['pt-PT'], 'en', true)).toEqual(['pt-PT', 'en']);
  });

  it('takes a Language unticked out, keeping the others in order', () => {
    expect(pickLanguage(['es', 'pt-PT', 'en'], 'pt-PT', false)).toEqual(['es', 'en']);
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
    expect(moveLanguage(['en', 'pt-PT', 'es'], 'pt-PT', -1)).toEqual(['pt-PT', 'en', 'es']);
    expect(moveLanguage(['en', 'pt-PT', 'es'], 'pt-PT', 1)).toEqual(['en', 'es', 'pt-PT']);
  });

  it('leaves the order as it is at either end', () => {
    expect(moveLanguage(['en', 'pt-PT'], 'en', -1)).toEqual(['en', 'pt-PT']);
    expect(moveLanguage(['en', 'pt-PT'], 'pt-PT', 1)).toEqual(['en', 'pt-PT']);
  });
});
