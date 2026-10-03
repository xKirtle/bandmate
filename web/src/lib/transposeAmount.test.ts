import { describe, expect, it } from 'vitest';
import { readTranspose, storeTranspose, transposeKey } from './transposeAmount';

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

describe('readTranspose', () => {
  it('is 0, as written, until transposed on this device', () => {
    expect(readTranspose(storage(), 1)).toBe(0);
  });

  it('is 0 without storage, or when it is blocked', () => {
    expect(readTranspose(undefined, 1)).toBe(0);
    expect(readTranspose(storage({}, true), 1)).toBe(0);
  });

  it("is 0 when what's kept isn't an amount from −11 to +11", () => {
    for (const kept of ['12', '-12', 'up', '1.5', '']) {
      expect(readTranspose(storage({ [transposeKey(1)]: kept }), 1)).toBe(0);
    }
  });
});

describe('storeTranspose', () => {
  it('keeps the amount for that Song only', () => {
    const s = storage();
    storeTranspose(s, 1, -3);
    expect(readTranspose(s, 1)).toBe(-3);
    expect(readTranspose(s, 2)).toBe(0);
  });

  it('forgets the amount once back to 0', () => {
    const values = { [transposeKey(1)]: '2' };
    storeTranspose(storage(values), 1, 0);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeTranspose(undefined, 1, 2)).not.toThrow();
    expect(() => storeTranspose(storage({}, true), 1, 2)).not.toThrow();
  });
});
