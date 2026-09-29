import { describe, expect, it } from 'vitest';
import { addedTrack, chosenKey, chosenTrack, readChosen, storeChosen } from './chosenTrack';

const tracks = (...ids: number[]) => ids.map((id) => ({ id }));

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

describe('chosenTrack', () => {
  it('is none without Tracks', () => {
    expect(chosenTrack([], null)).toBeNull();
    expect(chosenTrack([], 3)).toBeNull();
  });

  it('is the bottom Track the first time', () => {
    expect(chosenTrack(tracks(1, 2, 3), null)).toBe(3);
  });

  it('is the remembered Track', () => {
    expect(chosenTrack(tracks(1, 2, 3), 1)).toBe(1);
  });

  it('is the bottom Track when the remembered one is gone', () => {
    expect(chosenTrack(tracks(1, 2, 3), 9)).toBe(3);
  });

  it('is the Track chosen', () => {
    expect(chosenTrack(tracks(1, 2, 3), 1, { kind: 'choose', trackId: 2 })).toBe(2);
  });

  it('keeps the remembered Track when the one chosen is gone', () => {
    expect(chosenTrack(tracks(1, 2, 3), 1, { kind: 'choose', trackId: 9 })).toBe(1);
  });

  it('is a Track just added with "Add a track"', () => {
    expect(chosenTrack(tracks(1, 2, 3), 1, { kind: 'add', trackId: 3 })).toBe(3);
  });

  it("isn't a Beat Track a first Beat adds below the others", () => {
    expect(chosenTrack(tracks(1, 2, 3), 1)).toBe(1);
  });

  it('is a Beat Track a first Beat adds as the only Track', () => {
    expect(chosenTrack(tracks(4), null)).toBe(4);
  });

  it('is the bottom Track once the chosen one is deleted', () => {
    expect(chosenTrack(tracks(1, 3), 2)).toBe(3);
  });

  it('keeps the chosen Track when another is deleted', () => {
    expect(chosenTrack(tracks(2, 3), 2)).toBe(2);
  });
});

describe('addedTrack', () => {
  it('is the Track that wasn\'t there before', () => {
    expect(addedTrack(tracks(1, 2), tracks(1, 2, 5))).toBe(5);
  });

  it('is null when none was added', () => {
    expect(addedTrack(tracks(1, 2), tracks(1, 2))).toBeNull();
    expect(addedTrack(tracks(1, 2), tracks(1))).toBeNull();
  });
});

describe('readChosen', () => {
  it('is the Track stored for the Song', () => {
    expect(readChosen(storage({ [chosenKey(7)]: '12' }), 7)).toBe(12);
  });

  it('is kept apart for each Song', () => {
    expect(readChosen(storage({ [chosenKey(7)]: '12' }), 8)).toBeNull();
  });

  it.each(['', 'lead', '-1', '1.5'])('is null for a stored %j', (value) => {
    expect(readChosen(storage({ [chosenKey(7)]: value }), 7)).toBeNull();
  });

  it('is null without storage, or when it is blocked', () => {
    expect(readChosen(undefined, 7)).toBeNull();
    expect(readChosen(storage({}, true), 7)).toBeNull();
  });
});

describe('storeChosen', () => {
  it('stores a Track to be read back for the Song', () => {
    const s = storage();
    storeChosen(s, 7, 12);
    expect(readChosen(s, 7)).toBe(12);
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeChosen(undefined, 7, 12)).not.toThrow();
    expect(() => storeChosen(storage({}, true), 7, 12)).not.toThrow();
  });
});
