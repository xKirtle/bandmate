import { describe, expect, it } from 'vitest';
import { readTranspose, stepTranspose, storeTranspose, transposeKey, transposeText } from './transposeAmount';

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

describe('stepTranspose', () => {
  it('steps by a semitone, held from −11 to +11', () => {
    expect(stepTranspose(0, 1)).toBe(1);
    expect(stepTranspose(-3, -1)).toBe(-4);
    expect(stepTranspose(11, 1)).toBe(11);
    expect(stepTranspose(-11, -1)).toBe(-11);
  });
});

describe('transposeText', () => {
  it('signs the amount, with 0 as written', () => {
    expect(transposeText(2)).toBe('+2');
    expect(transposeText(-3)).toBe('−3');
    expect(transposeText(0)).toBe('0');
  });
});
