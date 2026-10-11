import { SvelteMap } from 'svelte/reactivity';
import { api } from './api';
import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { readLanguageData, type LanguageData } from './lyricsLanguage';
import { writingAidsSetting } from './writingAids';

// Whether Write mode shows its writing aids, shared by the Lyric Sheet's
// toggle, Settings, and every part of the Song page that shows a Syllable
// Count, so turning them off anywhere, in any of this device's tabs, hides
// them all.

export const writingAids = new DeviceSetting(writingAidsSetting, deviceStorage(), window);

// The data of each Language fetched so far, kept for as long as the page is
// open, so each is fetched once at most, and only once it's needed.
const fetched = new SvelteMap<string, LanguageData>();
const asked = new Set<string>();

/** The Languages' data fetched so far. */
export function languageData(): LanguageData[] {
  return [...fetched.values()];
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
