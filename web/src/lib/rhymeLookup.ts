// Which Rhymes the Rhymes card shows: for a word, in one of the
// Song's Languages, which starts as the one the word is read in.

import type { LyricsLanguage, Rhymes } from './lyricsLanguage';

/** A word's Rhymes as the card shows them. */
export interface RhymeLookup {
  /** The word Rhymes are for, or null while there's none. */
  word: string | null;
  /** The Language they're in, or null until it's known. */
  language: string | null;
  /** The word's Rhymes, or null when the Language can't read it, or while loading. */
  rhymes: Rhymes | null;
  /** Whether the Language's data is still on its way. */
  loading: boolean;
}

/**
 * Rhymes for a word of a Song sung in `languages`: in `picked`, when it's
 * one of them, or else in the Language the word is read in.
 */
export function lookUpRhymes(
  lyrics: LyricsLanguage,
  word: string | null,
  languages: readonly string[],
  picked: string | null = null,
): RhymeLookup {
  if (!word) return { word: null, language: null, rhymes: null, loading: false };
  const language = picked && languages.includes(picked) ? picked : lyrics.languageOf(word, languages);
  if (!language || !lyrics.hasData(language)) return { word, language, rhymes: null, loading: true };
  return { word, language, rhymes: lyrics.rhymes(word, language), loading: false };
}
