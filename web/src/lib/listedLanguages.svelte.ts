// The Languages Bandmate rhymes in, as it lists them (GET /api/languages),
// with their names: what the Languages picker offers, Settings' Rhyming
// dictionaries card lists, and the Rhymes card names. Bandmate keeps the one
// list of them, so the page has none of its own. It's asked for the first
// time it's read, and again when asked to load after Bandmate couldn't be
// reached; until then it's empty, and a Language shows by its code.
import type { ListedLanguage } from './api';

export class ListedLanguages {
  #ask: () => Promise<ListedLanguage[]>;
  #list = $state<readonly ListedLanguage[]>([]);
  /** Whether Bandmate has listed them, or is being asked to. */
  #asked = false;

  constructor(ask: () => Promise<ListedLanguage[]>) {
    this.#ask = ask;
  }

  /** The Languages, in Bandmate's order, once it's listed them; asks for them the first time it's read. */
  get list(): readonly ListedLanguage[] {
    this.load();
    return this.#list;
  }

  /** Asks Bandmate for the Languages, unless it's listed them or is being asked. */
  load(): void {
    if (this.#asked) return;
    this.#asked = true;
    this.#ask().then(
      (list) => (this.#list = list),
      () => (this.#asked = false), // Offline, say: asked again on the next load.
    );
  }
}
