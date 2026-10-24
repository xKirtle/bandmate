import { describe, expect, it } from 'vitest';
import {
  autoScrollSpeedKey,
  fastestSpeed,
  readAutoScrollSpeed,
  slowestSpeed,
  startingSpeed,
  stepAutoScrollSpeed,
  storeAutoScrollSpeed,
} from './autoScrollSpeed';
import { storage } from './storageFake';

describe('readAutoScrollSpeed', () => {
  it('is 4 until set on this device', () => {
    expect(startingSpeed).toBe(4);
    expect(readAutoScrollSpeed(storage(), 1)).toBe(4);
  });

  it('is 4 without storage, or when it is blocked', () => {
    expect(readAutoScrollSpeed(undefined, 1)).toBe(4);
    expect(readAutoScrollSpeed(storage({}, true), 1)).toBe(4);
  });

  it("is 4 when what's kept isn't a level from 1 to 10", () => {
    for (const kept of ['0', '11', '-1', 'fast', '2.5', '']) {
      expect(readAutoScrollSpeed(storage({ [autoScrollSpeedKey(1)]: kept }), 1)).toBe(4);
    }
  });
});

describe('storeAutoScrollSpeed', () => {
  it('keeps the level for that Song only', () => {
    const s = storage();
    storeAutoScrollSpeed(s, 1, 7);
    expect(readAutoScrollSpeed(s, 1)).toBe(7);
    expect(readAutoScrollSpeed(s, 2)).toBe(4);
  });

  it('keeps the slowest and fastest levels', () => {
    const s = storage();
    storeAutoScrollSpeed(s, 1, 1);
    storeAutoScrollSpeed(s, 2, 10);
    expect(readAutoScrollSpeed(s, 1)).toBe(1);
    expect(readAutoScrollSpeed(s, 2)).toBe(10);
  });

  it('forgets the level once back to 4', () => {
    const values = { [autoScrollSpeedKey(1)]: '6' };
    storeAutoScrollSpeed(storage(values), 1, 4);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeAutoScrollSpeed(undefined, 1, 6)).not.toThrow();
    expect(() => storeAutoScrollSpeed(storage({}, true), 1, 6)).not.toThrow();
  });
});

describe('stepAutoScrollSpeed', () => {
  it('steps a level at a time, held from 1 to 10', () => {
    expect([slowestSpeed, fastestSpeed]).toEqual([1, 10]);
    expect(stepAutoScrollSpeed(4, 1)).toBe(5);
    expect(stepAutoScrollSpeed(4, -1)).toBe(3);
    expect(stepAutoScrollSpeed(10, 1)).toBe(10);
    expect(stepAutoScrollSpeed(1, -1)).toBe(1);
  });
});
