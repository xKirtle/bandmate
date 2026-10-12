// Which Rhymes the Rhymes card shows: for a word, in one of the Song's
// Languages, which starts as the one the word is read in, or why there are
// none, such as a Language whose dictionary isn't downloaded to this device.

import type { LyricsLanguage, Rhymes } from './lyricsLanguage';

/** A word's Rhymes as the card shows them. */
export interface RhymeLookup {
  /** The word Rhymes are for, or null while there's none. */
  word: string | null;
  /** The Language they're in, or null when it isn't known. */
  language: string | null;
  /** The word's Rhymes, or null when there are none to show. */
  rhymes: Rhymes | null;
  /** Whether the dictionaries downloaded are still on their way. */
  loading: boolean;
  /** The Song's Languages whose dictionaries to download in Settings for the word to be looked up in them. */
  toSetUp: string[];
  /** The Song's downloaded Languages whose dictionaries don't have the word, while some others aren't downloaded. */
  notIn: string[];
}

/**
 * Rhymes for a word of a Song sung in `languages`: in `picked`, when it's
 * one of them, or else in the Language the word is read in. `loading` says
 * the dictionaries downloaded aren't all read yet, so nothing can be told.
 */
export function lookUpRhymes(
  lyrics: LyricsLanguage,
  word: string | null,
  languages: readonly string[],
  picked: string | null = null,
  loading = false,
): RhymeLookup {
  const none = { word, language: null, rhymes: null, loading: false, toSetUp: [], notIn: [] };
  if (loading) return { ...none, loading: true };
  const setUp = languages.filter((code) => lyrics.isSetUp(code));
  const notSetUp = languages.filter((code) => !lyrics.isSetUp(code));
  if (setUp.length === 0) return { ...none, toSetUp: notSetUp };
  if (!word) return none;
  if (picked && languages.includes(picked)) {
    if (!lyrics.isSetUp(picked)) return { ...none, language: picked, toSetUp: [picked] };
    return { ...none, language: picked, rhymes: lyrics.rhymes(word, picked) };
  }
  const language = lyrics.languageOf(word, languages);
  if (!language) return { ...none, toSetUp: notSetUp, notIn: setUp };
  return { ...none, language, rhymes: lyrics.rhymes(word, language) };
}
