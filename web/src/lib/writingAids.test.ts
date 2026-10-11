import { describe, expect, it } from 'vitest';
import { DeviceSetting } from './deviceSetting.svelte';
import { readWritingAids, storeWritingAids, writingAidsOffKey, writingAidsSetting } from './writingAids';

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

describe('readWritingAids', () => {
  it('is on until turned off on this device', () => {
    expect(readWritingAids(storage())).toBe(true);
  });

  it('is on without storage, or when it is blocked', () => {
    expect(readWritingAids(undefined)).toBe(true);
    expect(readWritingAids(storage({}, true))).toBe(true);
  });

  it('is off once turned off on this device', () => {
    expect(readWritingAids(storage({ [writingAidsOffKey]: '1' }))).toBe(false);
  });
});

describe('storeWritingAids', () => {
  it('keeps them off, to read back after a reload', () => {
    const s = storage();
    storeWritingAids(s, false);
    expect(readWritingAids(s)).toBe(false);
  });

  it('forgets the choice once on again', () => {
    const values = { [writingAidsOffKey]: '1' };
    storeWritingAids(storage(values), true);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeWritingAids(undefined, false)).not.toThrow();
    expect(() => storeWritingAids(storage({}, true), false)).not.toThrow();
  });
});

describe("The writing aids' Device Setting", () => {
  /** The writing aids as the app keeps them, in a stand-in Storage this device's other tabs share. */
  function setting(values: Record<string, string> = {}, blocked = false) {
    const tabs = new EventTarget();
    const aids = new DeviceSetting(writingAidsSetting, storage(values, blocked), tabs);
    /** Another tab keeps a value, or clears storage with a null key, as the browser tells this one. */
    const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { aids, values, otherTab };
  }

  it('is on by default', () => {
    expect(setting().aids.value).toBe(true);
  });

  it('is on when storage is blocked', () => {
    expect(setting({}, true).aids.value).toBe(true);
  });

  it('keeps them off, to read back after a reload', () => {
    const { aids, values } = setting();
    aids.set(false);
    expect(aids.value).toBe(false);
    expect(setting(values).aids.value).toBe(false);
  });

  it('turns them off when another tab does', () => {
    const { aids, values, otherTab } = setting();
    values[writingAidsOffKey] = '1';
    otherTab(writingAidsOffKey);
    expect(aids.value).toBe(false);
  });

  it('turns them on again when another tab clears storage', () => {
    const { aids, values, otherTab } = setting({ [writingAidsOffKey]: '1' });
    delete values[writingAidsOffKey];
    otherTab(null);
    expect(aids.value).toBe(true);
  });
});
