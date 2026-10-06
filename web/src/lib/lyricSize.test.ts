import { describe, expect, it } from 'vitest';
import { DeviceSetting } from './deviceSetting.svelte';
import { lyricSizeKey, lyricSizeSetting, readLyricSize, stepLyricSize, storeLyricSize } from './lyricSize';

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

describe('readLyricSize', () => {
  it('is 100% until set on this device', () => {
    expect(readLyricSize(storage())).toBe(100);
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

  it('is held from 80% to 175%', () => {
    expect(stepLyricSize(175, 1)).toBe(175);
    expect(stepLyricSize(80, -1)).toBe(80);
  });
});

describe('The Lyric Size as the app keeps it', () => {
  /** The Lyric Size as the app keeps it, in a stand-in Storage this device's other tabs share. */
  function setting(values: Record<string, string> = {}) {
    const tabs = new EventTarget();
    const size = new DeviceSetting(lyricSizeSetting, storage(values), tabs);
    /** Another tab keeps a value, as the browser tells this one. */
    const otherTab = (key: string) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { size, values, otherTab };
  }

  it('keeps a size, to read back after a reload', () => {
    const { size, values } = setting();
    size.set(150);
    expect(size.value).toBe(150);
    expect(setting(values).size.value).toBe(150);
  });

  it('changes when another tab changes it', () => {
    const { size, values, otherTab } = setting();
    values[lyricSizeKey] = '80';
    otherTab(lyricSizeKey);
    expect(size.value).toBe(80);
  });
});
