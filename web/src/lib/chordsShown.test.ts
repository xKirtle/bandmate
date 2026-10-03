import { describe, expect, it } from 'vitest';
import { chordsHiddenKey, readChordsShown, songChordsShown, storeChordsShown } from './chordsShown';

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

describe('readChordsShown', () => {
  it('is shown until hidden on this device', () => {
    expect(readChordsShown(storage(), 1)).toBe(true);
  });

  it('is shown without storage, or when it is blocked', () => {
    expect(readChordsShown(undefined, 1)).toBe(true);
    expect(readChordsShown(storage({}, true), 1)).toBe(true);
  });

  it('is hidden once hidden for that Song', () => {
    expect(readChordsShown(storage({ [chordsHiddenKey(1)]: '1' }), 1)).toBe(false);
  });
});

describe('storeChordsShown', () => {
  it('keeps hiding for that Song only', () => {
    const s = storage();
    storeChordsShown(s, 1, false);
    expect(readChordsShown(s, 1)).toBe(false);
    expect(readChordsShown(s, 2)).toBe(true);
  });

  it('forgets the choice once shown again', () => {
    const values = { [chordsHiddenKey(1)]: '1' };
    storeChordsShown(storage(values), 1, true);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeChordsShown(undefined, 1, false)).not.toThrow();
    expect(() => storeChordsShown(storage({}, true), 1, false)).not.toThrow();
  });
});

describe('songChordsShown', () => {
  it("shares whether a Song's Chords show, for that Song only", () => {
    expect(songChordsShown.of(7)).toBe(true);
    songChordsShown.set(7, false);
    expect(songChordsShown.of(7)).toBe(false);
    expect(songChordsShown.of(8)).toBe(true);
    songChordsShown.set(7, true);
    expect(songChordsShown.of(7)).toBe(true);
  });
});
