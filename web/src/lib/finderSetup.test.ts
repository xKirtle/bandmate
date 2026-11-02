import { describe, expect, it } from 'vitest';
import { finderKeyKey, readFinderKey, storeFinderKey } from './finderSetup';
import { storage } from './storageFake';

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
