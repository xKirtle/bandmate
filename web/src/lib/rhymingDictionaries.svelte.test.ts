import { describe, expect, it } from 'vitest';
import {
  RhymingDictionaries,
  type DictionaryStore,
  type Download,
  type StoredDictionary,
} from './rhymingDictionaries.svelte';

/** The browser's store as a Map, which survives the page being made again, as a reload. */
class FakeStore implements DictionaryStore {
  kept = new Map<string, StoredDictionary>();
  async list() {
    return [...this.kept.values()].map(({ code, updatedAt }) => ({ code, updatedAt }));
  }
  async get(code: string) {
    return this.kept.get(code);
  }
  async put(d: StoredDictionary) {
    this.kept.set(d.code, d);
  }
  async remove(code: string) {
    this.kept.delete(code);
  }
}

/** Bandmate serving a Language's data, as a dictionary of one word, tagged by its version. */
class FakeServer {
  version = 1;
  offline = false;
  asked: { code: string; etag?: string }[] = [];
  download: Download = async (code, etag) => {
    this.asked.push({ code, etag });
    if (this.offline) throw new Error("Can't reach Bandmate.");
    const tag = `"v${this.version}"`;
    if (etag === tag) return null;
    const word = this.version === 1 ? 'night' : 'light';
    return { etag: tag, text: `${word} N AY1 T\n` };
  };
}

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 12, 12, clock++));

function page(store: FakeStore, server: FakeServer) {
  return new RhymingDictionaries(store, server.download, { now });
}

/** Lets the store's and server's answers come in. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** The words of a Language's dictionary as the page has read it. */
const words = (dictionaries: RhymingDictionaries, code: string) => [
  ...(dictionaries.loaded.find((d) => d.code === code)?.pronunciations.keys() ?? []),
];

describe('rhyming dictionaries', () => {
  it("downloads nothing for a Language that isn't set up, even once it's used", async () => {
    const server = new FakeServer();
    const dictionaries = page(new FakeStore(), server);
    await settle();

    dictionaries.use(['en', 'pt']);
    await settle();

    expect(server.asked).toEqual([]);
    expect(dictionaries.isSetUp('en')).toBe(false);
    expect(dictionaries.loading(['en', 'pt'])).toBe(false);
  });

  it('is loading until it has read which are set up', async () => {
    const dictionaries = page(new FakeStore(), new FakeServer());
    expect(dictionaries.loading(['en'])).toBe(true);
    await settle();
    expect(dictionaries.loading(['en'])).toBe(false);
  });

  it('sets one up, keeping it with when it was last updated', async () => {
    const store = new FakeStore();
    const dictionaries = page(store, new FakeServer());
    await settle();

    await dictionaries.setUp('en');

    expect(dictionaries.isSetUp('en')).toBe(true);
    expect(dictionaries.updatedAt('en')).toMatch(/^2026-10-12T12:/);
    expect(store.kept.get('en')?.text).toBe('night N AY1 T\n');
  });

  it('works after a reload and offline, from what was kept', async () => {
    const store = new FakeStore();
    const server = new FakeServer();
    await page(store, server).setUp('en');
    server.offline = true;

    const reloaded = page(store, server);
    await settle();
    reloaded.use(['en']);
    expect(reloaded.loading(['en'])).toBe(true);
    await settle();

    expect(reloaded.isSetUp('en')).toBe(true);
    expect(reloaded.loading(['en'])).toBe(false);
    expect(words(reloaded, 'en')).toEqual(['night']);
  });

  it("refreshes itself when it's used once Bandmate's data has changed", async () => {
    const store = new FakeStore();
    const server = new FakeServer();
    await page(store, server).setUp('en');
    const setUpAt = store.kept.get('en')!.updatedAt;
    server.version = 2;

    const reloaded = page(store, server);
    await settle();
    reloaded.use(['en']);
    await settle();
    await settle();

    expect(server.asked.at(-1)).toEqual({ code: 'en', etag: '"v1"' });
    expect(words(reloaded, 'en')).toEqual(['light']);
    expect(store.kept.get('en')?.text).toBe('light N AY1 T\n');
    expect(reloaded.updatedAt('en')).not.toBe(setUpAt);
  });

  it("keeps what it has when Bandmate's data hasn't changed, asking once a visit", async () => {
    const store = new FakeStore();
    const server = new FakeServer();
    await page(store, server).setUp('en');
    const setUpAt = store.kept.get('en')!.updatedAt;

    const reloaded = page(store, server);
    await settle();
    reloaded.use(['en']);
    await settle();
    reloaded.use(['en']);
    await settle();

    expect(server.asked).toEqual([{ code: 'en' }, { code: 'en', etag: '"v1"' }]);
    expect(reloaded.updatedAt('en')).toBe(setUpAt);
  });

  it("removes one, so it's no longer set up, nor kept", async () => {
    const store = new FakeStore();
    const dictionaries = page(store, new FakeServer());
    await dictionaries.setUp('en');
    dictionaries.use(['en']);
    await settle();

    await dictionaries.remove('en');

    expect(dictionaries.isSetUp('en')).toBe(false);
    expect(dictionaries.loaded).toEqual([]);
    expect(store.kept.has('en')).toBe(false);
  });

  it("downloads it again when what's kept can't be read", async () => {
    const store = new FakeStore();
    const server = new FakeServer();
    await page(store, server).setUp('en');
    store.get = async () => {
      throw new Error('IndexedDB broke');
    };

    const reloaded = page(store, server);
    await settle();
    reloaded.use(['en']);
    await settle();
    await settle();

    expect(words(reloaded, 'en')).toEqual(['night']);
  });

  it('keeps one set up while it was listing which are', async () => {
    const store = new FakeStore();
    // The list as it was before setting up, answered only once that's done.
    const stale = store.list();
    let listed!: () => void;
    const list = store.list.bind(store);
    store.list = () => new Promise((resolve) => (listed = () => resolve(stale)));
    const dictionaries = page(store, new FakeServer());
    store.list = list;

    await dictionaries.setUp('en');
    listed();
    await settle();
    await settle();

    expect(dictionaries.isSetUp('en')).toBe(true);
  });

  it("isn't set up when its download fails", async () => {
    const server = new FakeServer();
    server.offline = true;
    const dictionaries = page(new FakeStore(), server);
    await settle();

    await expect(dictionaries.setUp('en')).rejects.toThrow("Can't reach Bandmate.");
    expect(dictionaries.isSetUp('en')).toBe(false);
    expect(dictionaries.settingUp('en')).toBe(false);
  });
});
