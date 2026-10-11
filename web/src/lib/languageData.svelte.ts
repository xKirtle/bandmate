import { SvelteMap } from 'svelte/reactivity';
import { api } from './api';
import { readLanguageData, type LanguageData } from './lyricsLanguage';

// The data of each Language fetched so far, kept for as long as the page is
// open, so each is fetched once at most, and only once it's asked for.

const fetched = new SvelteMap<string, LanguageData>();
const asked = new Set<string>();

/** The Languages' data fetched so far. */
export function languageData(): LanguageData[] {
  return [...fetched.values()];
}

/** Whether a Language's data has been fetched. */
export function hasLanguageData(code: string): boolean {
  return fetched.has(code);
}

/** Fetches the data of each of these Languages not fetched yet. One that fails is asked for again next time. */
export function fetchLanguageData(codes: readonly string[]) {
  for (const code of codes) {
    if (asked.has(code)) continue;
    asked.add(code);
    api.getLanguageData(code).then(
      (text) => fetched.set(code, readLanguageData(code, text)),
      () => asked.delete(code),
    );
  }
}
