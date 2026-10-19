import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ClipMerge, type SongAt, type SoundImport } from './api';
import { savedRetrying, songServer } from './songServer';

// Importing a Sound and merging Clips send a file, so they aren't changes the
// contract test records: these pin the requests they send instead.
describe('the writes that send a file', () => {
  const at: SongAt = { id: 7, version: 3 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** What the next request sends, with the file part read back as its name. */
  function sent() {
    const requests: { method?: string; url: string; details: unknown; file: string; ifMatch?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get('file') as File;
      requests.push({
        method: init.method,
        url,
        details: JSON.parse(form.get('details') as string),
        file: file.name,
        ifMatch: (init.headers as Record<string, string>)['If-Match'],
      });
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    return requests;
  }

  it('imports a Sound as the file under its own name, with its details', async () => {
    const requests = sent();
    const details: SoundImport = { trackId: 2, name: 'Shaker', duration: 4, peaks: [0.5] };
    await songServer(at.id).importSound(at, new File(['wav'], 'shaker.wav'), details);
    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/api/songs/7/timeline/sounds',
        details,
        file: 'shaker.wav',
        ifMatch: '"3"',
      },
    ]);
  });

  it('merges Clips as the rendered WAV, with the Clips it merged', async () => {
    const requests = sent();
    const merge: ClipMerge = { clipIds: [1, 2], peaks: [0.25], trackId: 2 };
    await songServer(at.id).mergeClips(at, new Blob(['wav']), merge);
    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/api/songs/7/timeline/clips/merge',
        details: merge,
        file: 'merged.wav',
        ifMatch: '"3"',
      },
    ]);
  });
});

describe('savedRetrying', () => {
  // Waits nothing, noting how long each wait was asked to be.
  function noWait() {
    const waits: number[] = [];
    return { waits, wait: async (ms: number) => void waits.push(ms) };
  }

  // A save failing with each error given in turn, then succeeding.
  function failing(...errors: Error[]) {
    let tries = 0;
    return {
      tries: () => tries,
      save: async () => {
        const e = errors[tries++];
        if (e) throw e;
        return 'saved';
      },
    };
  }

  const offline = () => new ApiError(0, "Can't reach Bandmate. Check your connection.");
  const serverError = () => new ApiError(500, 'Request failed (500)');

  it('gives what a save that succeeds saved, trying once', async () => {
    const save = failing();
    expect(await savedRetrying(save.save, noWait().wait)).toBe('saved');
    expect(save.tries()).toBe(1);
  });

  it('tries again after a network or server error, waiting longer each time', async () => {
    const save = failing(offline(), serverError());
    const { waits, wait } = noWait();
    expect(await savedRetrying(save.save, wait)).toBe('saved');
    expect(save.tries()).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('gives up after a few seconds, failing as the last try did', async () => {
    const last = serverError();
    const save = failing(offline(), offline(), offline(), last, offline());
    const { waits, wait } = noWait();
    await expect(savedRetrying(save.save, wait)).rejects.toBe(last);
    expect(save.tries()).toBe(4);
    expect(waits.reduce((a, b) => a + b)).toBeLessThanOrEqual(5000);
  });

  it("doesn't try again when the server refused the save", async () => {
    const refused = new ApiError(422, 'A blank Line can’t have a Cue');
    const save = failing(refused);
    await expect(savedRetrying(save.save, noWait().wait)).rejects.toBe(refused);
    expect(save.tries()).toBe(1);
  });

  it("doesn't try again when the Song changed elsewhere", async () => {
    const stale = new ApiError(409, 'The Song changed elsewhere', 'stale');
    const save = failing(stale);
    await expect(savedRetrying(save.save, noWait().wait)).rejects.toBe(stale);
    expect(save.tries()).toBe(1);
  });
});
