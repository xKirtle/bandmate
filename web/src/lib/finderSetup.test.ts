import { describe, expect, it } from 'vitest';
import { capoLimit, finderCapoKey, finderTuningKey, readFinderSetup, storeFinderSetup } from './finderSetup';

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

const standard = { tuning: 'Standard', capo: 0 };

describe('readFinderSetup', () => {
  it('is standard tuning and no capo until picked on this device', () => {
    expect(readFinderSetup(storage())).toEqual(standard);
  });

  it('is standard tuning and no capo without storage, or when it is blocked', () => {
    expect(readFinderSetup(undefined)).toEqual(standard);
    expect(readFinderSetup(storage({}, true))).toEqual(standard);
  });
});

describe('storeFinderSetup', () => {
  it('keeps the tuning and capo picked, to read back after a reload', () => {
    const s = storage();
    storeFinderSetup(s, { tuning: 'Drop D', capo: 2 });
    expect(readFinderSetup(s)).toEqual({ tuning: 'Drop D', capo: 2 });
  });

  it('keeps a custom tuning as its six notes', () => {
    const s = storage();
    storeFinderSetup(s, { tuning: 'C G D G B D', capo: 0 });
    expect(readFinderSetup(s)).toEqual({ tuning: 'C G D G B D', capo: 0 });
  });

  it('forgets the choice once back to standard tuning and no capo', () => {
    const values: Record<string, string> = {};
    storeFinderSetup(storage(values), { tuning: 'Open G', capo: 5 });
    storeFinderSetup(storage(values), standard);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeFinderSetup(undefined, { tuning: 'Drop D', capo: 2 })).not.toThrow();
    expect(() => storeFinderSetup(storage({}, true), { tuning: 'Drop D', capo: 2 })).not.toThrow();
  });
});

describe('a kept setup that has gone wrong', () => {
  it('reads a tuning it can no longer read as standard tuning, keeping the capo', () => {
    const values = { [finderTuningKey]: 'Nashville', [finderCapoKey]: '3' };
    expect(readFinderSetup(storage(values))).toEqual({ tuning: 'Standard', capo: 3 });
  });

  it('reads a capo that is not a fret it offers as no capo, keeping the tuning', () => {
    for (const capo of ['-1', '1.5', 'two', String(capoLimit + 1)]) {
      const values = { [finderTuningKey]: 'Drop D', [finderCapoKey]: capo };
      expect(readFinderSetup(storage(values)), capo).toEqual({ tuning: 'Drop D', capo: 0 });
    }
  });
});
