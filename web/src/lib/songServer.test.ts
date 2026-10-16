import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { savedRetrying } from './songServer';

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
