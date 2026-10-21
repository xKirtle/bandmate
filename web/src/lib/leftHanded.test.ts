import { describe, expect, it } from 'vitest';
import { leftHandedKey, readLeftHanded, storeLeftHanded } from './leftHanded';

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

describe('readLeftHanded', () => {
  it('is right-handed until set on this device', () => {
    expect(readLeftHanded(storage())).toBe(false);
  });

  it('is right-handed without storage, or when it is blocked', () => {
    expect(readLeftHanded(undefined)).toBe(false);
    expect(readLeftHanded(storage({}, true))).toBe(false);
  });

  it('is left-handed once set on this device', () => {
    expect(readLeftHanded(storage({ [leftHandedKey]: '1' }))).toBe(true);
  });
});

describe('storeLeftHanded', () => {
  it('keeps left-handed, to read back after a reload', () => {
    const s = storage();
    storeLeftHanded(s, true);
    expect(readLeftHanded(s)).toBe(true);
  });

  it('forgets the choice once right-handed again', () => {
    const values = { [leftHandedKey]: '1' };
    storeLeftHanded(storage(values), false);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeLeftHanded(undefined, true)).not.toThrow();
    expect(() => storeLeftHanded(storage({}, true), true)).not.toThrow();
  });
});
