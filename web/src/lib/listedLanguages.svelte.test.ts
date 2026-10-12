import { describe, expect, it } from 'vitest';
import type { ListedLanguage } from './api';
import { ListedLanguages } from './listedLanguages.svelte';

const spanish = { code: 'es', name: 'Spanish', size: 900_000 };

/** Bandmate listing its Languages, or unreachable. */
class FakeServer {
  listed: ListedLanguage[] = [spanish];
  offline = false;
  asked = 0;
  list = async () => {
    this.asked++;
    if (this.offline) throw new Error("Can't reach Bandmate.");
    return this.listed;
  };
}

/** Lets the page's pending promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('ListedLanguages', () => {
  it('lists the Languages Bandmate lists, asking it once', async () => {
    const server = new FakeServer();
    const languages = new ListedLanguages(server.list);

    expect(languages.list).toEqual([]);
    await settled();

    expect(languages.list).toEqual([spanish]);
    void languages.list;
    languages.load();
    expect(server.asked).toBe(1);
  });

  it('asks again once read after Bandmate could not be reached', async () => {
    const server = new FakeServer();
    server.offline = true;
    const languages = new ListedLanguages(server.list);
    void languages.list;
    await settled();

    server.offline = false;
    languages.load();
    await settled();

    expect(languages.list).toEqual([spanish]);
    expect(server.asked).toBe(2);
  });
});
