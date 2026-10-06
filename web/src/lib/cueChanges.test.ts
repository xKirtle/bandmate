import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { sameCues, savedRetrying, withCueChange } from './cueChanges';

// A Song of two Sections in the Arrangement and one in the Scrapbook. The
// Verse has an inactive Alternate, whose Line's Cue is dormant.
const song = {
  arrangement: [1, 2],
  sections: [
    {
      id: 1,
      alternates: [
        {
          active: true,
          lines: [
            { id: 10, text: 'One', cue: 1 },
            { id: 11, text: 'Two', cue: null },
          ],
        },
        { active: false, lines: [{ id: 12, text: 'Uno', cue: 1.5 }] },
      ],
    },
    { id: 2, alternates: [{ active: true, lines: [{ id: 20, text: 'Three', cue: 8.25 }] }] },
    { id: 3, alternates: [{ active: true, lines: [{ id: 30, text: 'Kept', cue: 20 }] }] },
  ],
};

/** Each Line's Cue, by Line id. */
function cues(s: typeof song): Record<number, number | null> {
  return Object.fromEntries(s.sections.flatMap((x) => x.alternates.flatMap((a) => a.lines.map((l) => [l.id, l.cue]))));
}

describe('withCueChange', () => {
  it("sets a Line's Cue, leaving the others", () => {
    expect(cues(withCueChange(song, { kind: 'setLineCue', lineId: 11, cue: 4.5 }))).toEqual({
      10: 1,
      11: 4.5,
      12: 1.5,
      20: 8.25,
      30: 20,
    });
  });

  it("clears a Line's Cue", () => {
    expect(cues(withCueChange(song, { kind: 'setLineCue', lineId: 20, cue: null }))[20]).toBeNull();
  });

  it("clears a Section's Cues, dormant ones included", () => {
    expect(cues(withCueChange(song, { kind: 'clearSectionCues', sectionId: 1 }))).toEqual({
      10: null,
      11: null,
      12: null,
      20: 8.25,
      30: 20,
    });
  });

  it('clears every Cue, the Scrapbook’s and dormant ones included', () => {
    expect(cues(withCueChange(song, { kind: 'clearCues' }))).toEqual({
      10: null,
      11: null,
      12: null,
      20: null,
      30: null,
    });
  });

  it('shifts the Cues in a span, to the millisecond, wherever their Lines are', () => {
    expect(cues(withCueChange(song, { kind: 'shiftCues', start: 1.5, end: 20, by: 0.1 }))).toEqual({
      10: 1,
      11: null,
      12: 1.6,
      20: 8.35,
      30: 20,
    });
  });

  it('shifts nothing if any Cue would go before 0:00, as the server refuses it', () => {
    expect(cues(withCueChange(song, { kind: 'shiftCues', start: 0, end: 100, by: -1.2 }))).toEqual(cues(song));
  });

  it('restores each Cue given, setting or clearing it', () => {
    const restored = withCueChange(song, {
      kind: 'restoreCues',
      cues: [
        { lineId: 10, cue: null },
        { lineId: 30, cue: 21 },
      ],
    });
    expect(cues(restored)).toEqual({ 10: null, 11: null, 12: 1.5, 20: 8.25, 30: 21 });
  });

  it('keeps a Cue set or restored to the millisecond, as the server does', () => {
    expect(cues(withCueChange(song, { kind: 'setLineCue', lineId: 11, cue: 4.56789 }))[11]).toBe(4.568);
    expect(cues(withCueChange(song, { kind: 'restoreCues', cues: [{ lineId: 11, cue: 2.0004 }] }))[11]).toBe(2);
  });

  it('shifts nothing if any Cue would go before 0:00 by the step as given, before rounding', () => {
    // A step just over 1 s, which rounds to 1 s but, as given, takes the Cue at 1 s before 0:00.
    expect(cues(withCueChange(song, { kind: 'shiftCues', start: 0, end: 1.2, by: -1.0004 }))[10]).toBe(1);
  });

  it('leaves the Song it was given as it was', () => {
    const before = JSON.stringify(song);
    withCueChange(song, { kind: 'clearCues' });
    expect(JSON.stringify(song)).toBe(before);
  });

  it('keeps the rest of the Song', () => {
    const full = { ...song, title: 'Song', version: 7 };
    expect(withCueChange(full, { kind: 'clearCues' })).toMatchObject({
      title: 'Song',
      version: 7,
      arrangement: [1, 2],
    });
  });
});

describe('sameCues', () => {
  it('holds for Songs whose every Line has the same Cue', () => {
    const copy = { ...withCueChange(song, { kind: 'setLineCue', lineId: 10, cue: 1 }), title: 'other' };
    expect(sameCues(copy, song)).toBe(true);
  });

  it("fails when any Line's Cue differs, a dormant one's included", () => {
    expect(sameCues(withCueChange(song, { kind: 'setLineCue', lineId: 12, cue: 2 }), song)).toBe(false);
    expect(sameCues(withCueChange(song, { kind: 'setLineCue', lineId: 30, cue: null }), song)).toBe(false);
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
