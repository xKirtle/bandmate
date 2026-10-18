import { describe, expect, it } from 'vitest';
import { chartSizeKey, chartSizeSetting, readChartSize, stepChartSize, storeChartSize } from './chartSize';
import { DeviceSetting } from './deviceSetting.svelte';
import { lyricSizeKey, readLyricSize } from './lyricSize';

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

describe('readChartSize', () => {
  it('is 100% until set on this device', () => {
    expect(readChartSize(storage())).toBe(100);
  });

  it('is the size kept on this device, from 70% to 175%', () => {
    for (const size of [70, 80, 90, 115, 130, 150, 175]) {
      expect(readChartSize(storage({ [chartSizeKey]: String(size) }))).toBe(size);
    }
  });

  it('is 100% without storage, or when it is blocked', () => {
    expect(readChartSize(undefined)).toBe(100);
    expect(readChartSize(storage({}, true))).toBe(100);
  });

  it("is 100% when what's kept isn't one of the sizes", () => {
    expect(readChartSize(storage({ [chartSizeKey]: '50' }))).toBe(100);
    expect(readChartSize(storage({ [chartSizeKey]: '120' }))).toBe(100);
    expect(readChartSize(storage({ [chartSizeKey]: 'large' }))).toBe(100);
  });

  it('is apart from the Lyric Size', () => {
    expect(readChartSize(storage({ [lyricSizeKey]: '150' }))).toBe(100);
  });
});

describe('storeChartSize', () => {
  it('keeps a size, to read back after a reload', () => {
    const s = storage();
    storeChartSize(s, 130);
    expect(readChartSize(s)).toBe(130);
  });

  it('leaves the Lyric Size alone', () => {
    const s = storage();
    storeChartSize(s, 130);
    expect(readLyricSize(s)).toBe(100);
  });

  it('forgets the size once back to 100%', () => {
    const values = { [chartSizeKey]: '130' };
    storeChartSize(storage(values), 100);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeChartSize(undefined, 130)).not.toThrow();
    expect(() => storeChartSize(storage({}, true), 130)).not.toThrow();
  });
});

describe('stepChartSize', () => {
  it('steps up and down through the sizes', () => {
    expect(stepChartSize(100, 1)).toBe(115);
    expect(stepChartSize(115, 1)).toBe(130);
    expect(stepChartSize(130, 1)).toBe(150);
    expect(stepChartSize(150, 1)).toBe(175);
    expect(stepChartSize(100, -1)).toBe(90);
    expect(stepChartSize(90, -1)).toBe(80);
    expect(stepChartSize(80, -1)).toBe(70);
  });

  it('is held from 70% to 175%', () => {
    expect(stepChartSize(175, 1)).toBe(175);
    expect(stepChartSize(70, -1)).toBe(70);
  });
});

describe('The Chart Size as the app keeps it', () => {
  /** The Chart Size as the app keeps it, in a stand-in Storage this device's other tabs share. */
  function setting(values: Record<string, string> = {}) {
    const tabs = new EventTarget();
    const size = new DeviceSetting(chartSizeSetting, storage(values), tabs);
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
    values[chartSizeKey] = '80';
    otherTab(chartSizeKey);
    expect(size.value).toBe(80);
  });
});
