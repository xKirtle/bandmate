import { describe, expect, it } from 'vitest';
import {
  finderKeyKey,
  finderTuningKey,
  readFinderKey,
  readFinderTuning,
  storeFinderKey,
  storeFinderTuning,
} from './finderSetup';

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

describe('the tuning', () => {
  it('is standard tuning until picked on this device', () => {
    expect(readFinderTuning(storage())).toBe('Standard');
  });

  it('is standard tuning without storage, or when it is blocked', () => {
    expect(readFinderTuning(undefined)).toBe('Standard');
    expect(readFinderTuning(storage({}, true))).toBe('Standard');
  });

  it('keeps the tuning picked, to read back after a reload', () => {
    const s = storage();
    storeFinderTuning(s, 'Drop D');
    expect(readFinderTuning(s)).toBe('Drop D');
  });

  it('keeps a custom tuning as its six notes', () => {
    const s = storage();
    storeFinderTuning(s, 'C G D G B D');
    expect(readFinderTuning(s)).toBe('C G D G B D');
  });

  it('forgets the choice once back to standard tuning', () => {
    const values: Record<string, string> = {};
    storeFinderTuning(storage(values), 'Open G');
    storeFinderTuning(storage(values), 'Standard');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeFinderTuning(undefined, 'Drop D')).not.toThrow();
    expect(() => storeFinderTuning(storage({}, true), 'Drop D')).not.toThrow();
  });

  it('reads a tuning it can no longer read as standard tuning', () => {
    expect(readFinderTuning(storage({ [finderTuningKey]: 'Nashville' }))).toBe('Standard');
  });
});

describe('a capo kept from before', () => {
  // The Chord Finder once had a capo, kept on each device under this key.
  const capoKey = 'bandmate.chordFinder.capo';

  it('is deleted when the tuning is read, which still reads the kept tuning', () => {
    const values: Record<string, string> = { [finderTuningKey]: 'Drop D', [capoKey]: '3' };
    expect(readFinderTuning(storage(values))).toBe('Drop D');
    expect(values).toEqual({ [finderTuningKey]: 'Drop D' });
  });

  it('is deleted when no tuning is kept too', () => {
    const values: Record<string, string> = { [capoKey]: '5' };
    expect(readFinderTuning(storage(values))).toBe('Standard');
    expect(values).toEqual({});
  });
});

describe('the Key Suggest suggests from', () => {
  it('is C major until picked on this device, or without storage, or when it is blocked', () => {
    expect(readFinderKey(storage())).toBe('C');
    expect(readFinderKey(undefined)).toBe('C');
    expect(readFinderKey(storage({}, true))).toBe('C');
  });

  it('keeps the Key picked, to read back after a reload', () => {
    const s = storage();
    storeFinderKey(s, 'Em');
    expect(readFinderKey(s)).toBe('Em');
  });

  it('forgets the choice once back to C major', () => {
    const values: Record<string, string> = {};
    storeFinderKey(storage(values), 'Bb');
    storeFinderKey(storage(values), 'C');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeFinderKey(undefined, 'G')).not.toThrow();
    expect(() => storeFinderKey(storage({}, true), 'G')).not.toThrow();
  });

  it('reads a kept Key the picker does not offer as C major', () => {
    for (const key of ['H', 'Do', 'E minor', ''])
      expect(readFinderKey(storage({ [finderKeyKey]: key })), key).toBe('C');
  });
});
