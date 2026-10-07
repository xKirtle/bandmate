import { describe, expect, it } from 'vitest';
import type { Beat, BeatDetails, DecodedAudio, Fetched } from './api';
import { toDraft, type BeatDraft } from './beatDraft';
import { BeatToAdd, type BeatRead } from './beatToAdd.svelte';

const decoded: DecodedAudio = { duration: 2, peaks: [0.5, 0.5] };
const file = (name: string) => new File(['RIFF'], name, { type: 'audio/wav' });

/** A reader that suggests a title from the file's name, or refuses the files named. */
function stubReader(refused: Record<string, string> = {}) {
  return async (f: File): Promise<BeatRead> => {
    if (f.name in refused) throw new Error(refused[f.name]);
    return { decoded, draft: toDraft({ title: f.name.replace(/\..*$/, '') }) };
  };
}

/** An api recording the adds and discards it received, failing the next adds when told. */
function fakeApi() {
  const record = {
    added: [] as { file: string; details: BeatDetails }[],
    addedFetched: [] as { id: string; details: BeatDetails }[],
    discarded: [] as string[],
  };
  let failNext = 0;
  let ids = 0;
  const answer = (details: BeatDetails) => {
    if (failNext > 0) {
      failNext--;
      return Promise.reject(new Error('Disk full'));
    }
    return Promise.resolve({ id: ++ids, ...details } as Beat);
  };
  return {
    record,
    failNextAdds: (n: number) => (failNext = n),
    api: {
      addBeat: (f: File, details: BeatDetails) => {
        record.added.push({ file: f.name, details });
        return answer(details);
      },
      addFetchedBeat: (id: string, details: BeatDetails) => {
        record.addedFetched.push({ id, details });
        return answer(details);
      },
      discardFetched: (id: string) => {
        record.discarded.push(id);
        return Promise.resolve(null);
      },
    },
  };
}

/** A link's file, fetched and read, as the link box hands it over. */
function fromLink(id: string, sourceLink = `https://example.com/${id}`) {
  const fetched: Fetched = {
    id,
    title: 'Night Drive',
    producer: 'Kofi Beats',
    sourceLink,
    fileName: `${id}.wav`,
    contentType: 'audio/wav',
    size: 4,
  };
  const draft: BeatDraft = toDraft({ title: 'Night Drive', producer: 'Kofi Beats', sourceLink });
  return { fetched, file: file(`${id}.wav`), decoded, draft };
}

function setup(refused: Record<string, string> = {}) {
  const fake = fakeApi();
  const toAdd = new BeatToAdd(stubReader(refused), fake.api);
  return { toAdd, ...fake };
}

describe('BeatToAdd', () => {
  it("says why a file that can't be read wasn't, and holds nothing to add", async () => {
    const { toAdd } = setup({ 'broken.wav': '“broken.wav” can’t be played in this browser.' });

    await toAdd.read(file('broken.wav'));

    expect(toAdd.error).toBe('“broken.wav” can’t be played in this browser.');
    expect(toAdd.adding).toBeNull();
    expect(toAdd.busy).toBeNull();
  });

  it('reads a file into a draft with the details it suggests', async () => {
    const { toAdd } = setup();

    await toAdd.read(file('dark_trap.wav'));

    expect(toAdd.adding?.file.name).toBe('dark_trap.wav');
    expect(toAdd.adding?.draft.title).toBe('dark_trap');
    expect(toAdd.adding?.fetched).toBeUndefined();
    expect(toAdd.error).toBeNull();
  });

  it("reading another file discards a fetched file that wasn't added", async () => {
    const { toAdd, record } = setup();
    toAdd.take(fromLink('fetch-1'));
    expect(toAdd.adding?.fetched?.id).toBe('fetch-1');

    await toAdd.read(file('dark_trap.wav'));

    expect(record.discarded).toEqual(['fetch-1']);
    expect(toAdd.adding?.file.name).toBe('dark_trap.wav');
  });

  it('leaving discards a fetched file once, and empties the Beat being added', () => {
    const { toAdd, record } = setup();
    toAdd.take(fromLink('fetch-1'));

    toAdd.leave();
    toAdd.leave();

    expect(record.discarded).toEqual(['fetch-1']);
    expect(toAdd.adding).toBeNull();
  });

  it('closing discards a fetched file once, then closing again or leaving discards nothing more', () => {
    const { toAdd, record } = setup();
    toAdd.take(fromLink('fetch-1'));

    toAdd.close();
    toAdd.close();
    toAdd.leave();

    expect(record.discarded).toEqual(['fetch-1']);
  });

  it('leaving forgets the last error', async () => {
    const { toAdd } = setup({ 'broken.wav': 'Unreadable' });
    await toAdd.read(file('broken.wav'));

    toAdd.leave();

    expect(toAdd.error).toBeNull();
  });

  it('a file read after closing is not held', async () => {
    const { toAdd } = setup();
    const reading = toAdd.read(file('dark_trap.wav'));

    toAdd.close();
    await reading;

    expect(toAdd.adding).toBeNull();
  });

  it('a file fetched after closing is discarded at once', () => {
    const { toAdd, record } = setup();
    toAdd.close();

    toAdd.take(fromLink('fetch-1'));

    expect(record.discarded).toEqual(['fetch-1']);
    expect(toAdd.adding).toBeNull();
  });

  it('adds a file read as a Beat with its details, resolving with the Beat', async () => {
    const { toAdd, record } = setup();
    await toAdd.read(file('dark_trap.wav'));
    toAdd.adding!.draft.producer = ' Pryme ';
    toAdd.adding!.draft.bpm = '140';

    const beat = await toAdd.add();

    expect(beat).toMatchObject({ id: 1, title: 'dark_trap', producer: 'Pryme', bpm: 140 });
    expect(record.added).toMatchObject([
      { file: 'dark_trap.wav', details: { title: 'dark_trap', producer: 'Pryme', bpm: 140 } },
    ]);
    expect(toAdd.adding).toBeNull();
    expect(toAdd.busy).toBeNull();
  });

  it("adding a fetched file sends only its details, and doesn't discard it, even on leaving or closing", async () => {
    const { toAdd, record } = setup();
    toAdd.take(fromLink('fetch-1'));

    const beat = await toAdd.add();
    toAdd.leave();
    toAdd.close();

    expect(beat).toMatchObject({ title: 'Night Drive', producer: 'Kofi Beats' });
    expect(record.addedFetched).toMatchObject([{ id: 'fetch-1', details: { title: 'Night Drive' } }]);
    expect(record.added).toEqual([]);
    expect(record.discarded).toEqual([]);
  });

  it('says what is wrong with invalid details, sending nothing', async () => {
    const { toAdd, record } = setup();
    await toAdd.read(file('dark_trap.wav'));
    toAdd.adding!.draft.bpm = 'fast';

    const beat = await toAdd.add();

    expect(beat).toBeNull();
    expect(toAdd.error).toBe('BPM must be a whole number');
    expect(record.added).toEqual([]);
    expect(toAdd.adding?.draft.bpm).toBe('fast');
  });

  it('keeps the Beat being added and its details when adding fails, saying why', async () => {
    const { toAdd, record, failNextAdds } = setup();
    toAdd.take(fromLink('fetch-1'));
    toAdd.adding!.draft.title = 'Night Drive (Remix)';
    failNextAdds(1);

    const failed = await toAdd.add();

    expect(failed).toBeNull();
    expect(toAdd.error).toBe('Disk full');
    expect(toAdd.adding?.fetched?.id).toBe('fetch-1');
    expect(toAdd.adding?.draft.title).toBe('Night Drive (Remix)');
    expect(record.discarded).toEqual([]);

    // Trying again adds it, and forgets the error.
    const beat = await toAdd.add();
    expect(beat).toMatchObject({ title: 'Night Drive (Remix)' });
    expect(toAdd.error).toBeNull();
    expect(record.addedFetched.map((a) => a.id)).toEqual(['fetch-1', 'fetch-1']);
  });

  it('says what it is doing while adding', async () => {
    const { toAdd } = setup();
    await toAdd.read(file('dark_trap.wav'));
    const uploading = toAdd.add();
    expect(toAdd.busy).toBe('Uploading…');
    await uploading;

    toAdd.take(fromLink('fetch-1'));
    const adding = toAdd.add();
    expect(toAdd.busy).toBe('Adding…');
    await adding;
    expect(toAdd.busy).toBeNull();
  });

  it("closing while a fetched file is being added doesn't discard it", async () => {
    const { toAdd, record } = setup();
    toAdd.take(fromLink('fetch-1'));

    const adding = toAdd.add();
    toAdd.close();
    await adding;

    expect(record.discarded).toEqual([]);
  });

  describe("the Beat already in the Beat Library from the link's", () => {
    const library = [
      { id: 7, title: 'Night Drive', sourceLink: 'https://www.youtube.com/watch?v=night-drive' },
      { id: 8, title: 'Dark Trap', sourceLink: '' },
    ] as Beat[];

    it('is the Beat from the same link', () => {
      const { toAdd } = setup();
      toAdd.take(fromLink('fetch-1', 'https://www.youtube.com/watch?v=night-drive'));

      expect(toAdd.alreadyInLibrary(library)?.id).toBe(7);
    });

    it('is none for a link the Library has no Beat from, or while the Library is loading', () => {
      const { toAdd } = setup();
      toAdd.take(fromLink('fetch-1', 'https://www.youtube.com/watch?v=other'));

      expect(toAdd.alreadyInLibrary(library)).toBeNull();
      expect(toAdd.alreadyInLibrary(null)).toBeNull();
    });

    it('is none for a file read, whatever its details say', async () => {
      const { toAdd } = setup();
      await toAdd.read(file('night.wav'));
      toAdd.adding!.draft.sourceLink = 'https://www.youtube.com/watch?v=night-drive';

      expect(toAdd.alreadyInLibrary(library)).toBeNull();
    });
  });
});
