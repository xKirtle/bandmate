// The rhyming dictionaries set up on this device: each Language's data,
// downloaded from Bandmate only when the user sets it up in Settings, and
// kept in the browser, so Rhymes work offline and after a reload. One set
// up is read in when it's first used on a page, and asks Bandmate once a
// visit whether its data changed since, taking the new data if so.
//
// What's kept is the Language's data as Bandmate serves it, with the tag
// that changes along with it, so whatever more a Language's download comes
// to hold is kept with it, and read by readLanguageData.
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { readLanguageData, type LanguageData } from './lyricsLanguage';

/** A dictionary set up on this device: its Language, and when its data last changed here. */
export interface SetUpDictionary {
  code: string;
  /** When it was set up or last refreshed, as an ISO time. */
  updatedAt: string;
}

/** A dictionary as it's kept: its data as Bandmate served it, and the tag Bandmate gave that. */
export interface StoredDictionary extends SetUpDictionary {
  etag: string;
  text: string;
}

/** Where the dictionaries set up are kept: the browser's IndexedDB, in the app. */
export interface DictionaryStore {
  list(): Promise<SetUpDictionary[]>;
  get(code: string): Promise<StoredDictionary | undefined>;
  put(dictionary: StoredDictionary): Promise<void>;
  remove(code: string): Promise<void>;
}

/**
 * Downloads a Language's data from Bandmate: null when it's still that
 * tagged `etag`, so what's kept is current.
 */
export type Download = (code: string, etag?: string) => Promise<{ etag: string; text: string } | null>;

export class RhymingDictionaries {
  #store: DictionaryStore;
  #download: Download;
  #now: () => Date;
  #changed: () => void;
  /** The dictionaries set up, by Language, once listed. */
  #setUp = new SvelteMap<string, string>();
  #listed = $state(false);
  #settingUp = new SvelteSet<string>();
  /** Those read in on this page, and when each was last updated as read. */
  #loaded = new SvelteMap<string, { data: LanguageData; updatedAt: string }>();
  /** Those asked to be read in, so each is read once, and whether Bandmate was asked about it this visit. */
  #asked = new Set<string>();
  #checked = new Set<string>();
  #failed = new SvelteSet<string>();

  /** `changed` tells this device's other tabs a dictionary was set up, refreshed or removed. */
  constructor(store: DictionaryStore, download: Download, now = () => new Date(), changed: () => void = () => {}) {
    this.#store = store;
    this.#download = download;
    this.#now = now;
    this.#changed = changed;
    void this.relist();
  }

  /**
   * Reads again which dictionaries are set up, as another tab changed them:
   * one removed or refreshed there is read in again, or dropped.
   */
  async relist() {
    let listed: SetUpDictionary[] = [];
    try {
      listed = await this.#store.list();
    } catch {
      // The browser keeps none, e.g. in a private window that refuses it.
    }
    this.#setUp.clear();
    for (const { code, updatedAt } of listed) this.#setUp.set(code, updatedAt);
    for (const [code, { updatedAt }] of this.#loaded) {
      if (this.#setUp.get(code) !== updatedAt) this.#forget(code);
    }
    this.#listed = true;
  }

  /** Whether a Language's dictionary is set up on this device. */
  isSetUp(code: string): boolean {
    return this.#setUp.has(code);
  }

  /** When a Language's dictionary was set up or last refreshed here, as an ISO time, if it's set up. */
  updatedAt(code: string): string | undefined {
    return this.#setUp.get(code);
  }

  /** Whether a Language's dictionary is being set up. */
  settingUp(code: string): boolean {
    return this.#settingUp.has(code);
  }

  /** The dictionaries read in on this page, to find Rhymes in. */
  get loaded(): LanguageData[] {
    return [...this.#loaded.values()].map((l) => l.data);
  }

  /**
   * Whether these Languages' dictionaries aren't all known yet: until it's
   * read which are set up, and while one set up is being read in.
   */
  loading(codes: readonly string[]): boolean {
    if (!this.#listed) return true;
    return codes.some((code) => this.#setUp.has(code) && !this.#loaded.has(code) && !this.#failed.has(code));
  }

  /** Reads in the dictionaries set up of these Languages, each once, then checks with Bandmate that it's current. */
  use(codes: readonly string[]) {
    for (const code of codes) {
      if (!this.#setUp.has(code) || this.#asked.has(code)) continue;
      this.#asked.add(code);
      void this.#read(code);
    }
  }

  async #read(code: string) {
    try {
      const kept = await this.#store.get(code);
      if (!kept) throw new Error(`${code} isn't kept`);
      this.#take(kept);
      await this.#refresh(kept);
    } catch {
      this.#asked.delete(code);
      this.#failed.add(code);
    }
  }

  /** Asks Bandmate, once a visit, whether a dictionary's data changed, and takes the new data if so. */
  async #refresh(kept: StoredDictionary) {
    if (this.#checked.has(kept.code)) return;
    this.#checked.add(kept.code);
    let fresh;
    try {
      fresh = await this.#download(kept.code, kept.etag);
    } catch {
      return; // Offline, say: what's kept still works.
    }
    if (!fresh || !this.#setUp.has(kept.code)) return;
    await this.#keep({ code: kept.code, updatedAt: this.#now().toISOString(), ...fresh });
  }

  /** Downloads a Language's dictionary and keeps it on this device. Throws why it couldn't. */
  async setUp(code: string) {
    this.#settingUp.add(code);
    try {
      const fresh = await this.#download(code);
      if (!fresh) throw new Error(`Bandmate sent no data for ${code}.`);
      this.#checked.add(code);
      await this.#keep({ code, updatedAt: this.#now().toISOString(), ...fresh });
    } finally {
      this.#settingUp.delete(code);
    }
  }

  async #keep(dictionary: StoredDictionary) {
    await this.#store.put(dictionary);
    this.#setUp.set(dictionary.code, dictionary.updatedAt);
    this.#failed.delete(dictionary.code);
    if (this.#asked.has(dictionary.code)) this.#take(dictionary);
    this.#changed();
  }

  #take({ code, text, updatedAt }: StoredDictionary) {
    if (this.#setUp.get(code) === updatedAt) this.#loaded.set(code, { data: readLanguageData(code, text), updatedAt });
  }

  /** Removes a Language's dictionary from this device. */
  async remove(code: string) {
    await this.#store.remove(code);
    this.#setUp.delete(code);
    this.#forget(code);
    this.#changed();
  }

  #forget(code: string) {
    this.#loaded.delete(code);
    this.#asked.delete(code);
    this.#failed.delete(code);
  }
}
