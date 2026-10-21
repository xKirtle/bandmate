import { describe, expect, it } from 'vitest';
import { lyricSizeKey, readLyricSize, stepLyricSize, storeLyricSize } from './lyricSize';
import { storage } from './storageFake';

describe('readLyricSize', () => {
  it('is 100% until set on this device', () => {
    expect(readLyricSize(storage())).toBe(100);
  });

  it('is the size kept on this device, from 50% to 175%', () => {
    for (const size of [50, 60, 70, 80, 90, 115, 130, 150, 175]) {
      expect(readLyricSize(storage({ [lyricSizeKey]: String(size) }))).toBe(size);
    }
  });

  it('is 100% without storage, or when it is blocked', () => {
    expect(readLyricSize(undefined)).toBe(100);
    expect(readLyricSize(storage({}, true))).toBe(100);
  });

  it("is 100% when what's kept isn't one of the sizes", () => {
    expect(readLyricSize(storage({ [lyricSizeKey]: '120' }))).toBe(100);
    expect(readLyricSize(storage({ [lyricSizeKey]: '500' }))).toBe(100);
    expect(readLyricSize(storage({ [lyricSizeKey]: 'large' }))).toBe(100);
  });
});

describe('storeLyricSize', () => {
  it('keeps a size, to read back after a reload', () => {
    const s = storage();
    storeLyricSize(s, 130);
    expect(readLyricSize(s)).toBe(130);
  });

  it('forgets the size once back to 100%', () => {
    const values = { [lyricSizeKey]: '130' };
    storeLyricSize(storage(values), 100);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeLyricSize(undefined, 130)).not.toThrow();
    expect(() => storeLyricSize(storage({}, true), 130)).not.toThrow();
  });
});

describe('stepLyricSize', () => {
  it('steps up and down through the sizes', () => {
    expect(stepLyricSize(100, 1)).toBe(115);
    expect(stepLyricSize(150, 1)).toBe(175);
    expect(stepLyricSize(100, -1)).toBe(90);
    expect(stepLyricSize(90, -1)).toBe(80);
  });

  it('steps down below 80% in tens, to 50%', () => {
    expect(stepLyricSize(80, -1)).toBe(70);
    expect(stepLyricSize(70, -1)).toBe(60);
    expect(stepLyricSize(60, -1)).toBe(50);
    expect(stepLyricSize(50, 1)).toBe(60);
  });

  it('is held from 50% to 175%', () => {
    expect(stepLyricSize(175, 1)).toBe(175);
    expect(stepLyricSize(50, -1)).toBe(50);
  });
});
