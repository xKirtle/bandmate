import { describe, expect, it } from 'vitest';
import { languageChoices, languageName, languagesLabel, moveLanguage, pickLanguage } from './languages';

// The Languages as Bandmate lists them, with their download sizes.
const known = [
  { code: 'en', name: 'English', size: 1 },
  { code: 'pt', name: 'Portuguese', size: 1 },
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
