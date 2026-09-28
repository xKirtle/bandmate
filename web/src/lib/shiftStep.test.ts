import { describe, expect, it } from 'vitest';
import { defaultShiftStep, readShiftStep, shiftStepKey, shiftSteps, storeShiftStep } from './shiftStep';

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

describe('shiftSteps', () => {
  it('offers 1 s, 0.5 s and 0.1 s, defaulting to the smallest', () => {
    expect(shiftSteps).toEqual([1, 0.5, 0.1]);
    expect(defaultShiftStep).toBe(0.1);
  });
});

describe('readShiftStep', () => {
  it('is the default until one is chosen', () => {
    expect(readShiftStep(storage())).toBe(0.1);
  });

  it('is the step chosen on this device', () => {
    expect(readShiftStep(storage({ [shiftStepKey]: '0.5' }))).toBe(0.5);
    expect(readShiftStep(storage({ [shiftStepKey]: '1' }))).toBe(1);
  });

  it('is the default for anything but one of the steps', () => {
    for (const kept of ['', '2', '0.25', 'abc', '-1']) {
      expect(readShiftStep(storage({ [shiftStepKey]: kept })), kept).toBe(0.1);
    }
  });

  it('is the default without storage, or when it is blocked', () => {
    expect(readShiftStep(undefined)).toBe(0.1);
    expect(readShiftStep(storage({ [shiftStepKey]: '1' }, true))).toBe(0.1);
  });
});

describe('storeShiftStep', () => {
  it('remembers the step chosen', () => {
    const s = storage();
    storeShiftStep(s, 0.5);
    expect(readShiftStep(s)).toBe(0.5);
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeShiftStep(undefined, 1)).not.toThrow();
    expect(() => storeShiftStep(storage({}, true), 1)).not.toThrow();
  });
});
