import { describe, expect, it } from 'vitest';
import { DeviceSetting } from './deviceSetting.svelte';
import { leftHandedKey, leftHandedSetting, readLeftHanded, storeLeftHanded } from './leftHanded';

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

describe("Left-handed's Device Setting", () => {
  /** Left-handed as the app keeps it, in a stand-in Storage this device's other tabs share. */
  function setting(values: Record<string, string> = {}) {
    const tabs = new EventTarget();
    const left = new DeviceSetting(leftHandedSetting, storage(values), tabs);
    /** Another tab keeps a value, or clears storage with a null key, as the browser tells this one. */
    const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { left, values, otherTab };
  }

  it('is right-handed until set on this device', () => {
    expect(setting().left.value).toBe(false);
  });

  it('keeps left-handed, to read back after a reload', () => {
    const { left, values } = setting();
    left.set(true);
    expect(left.value).toBe(true);
    expect(setting(values).left.value).toBe(true);
  });

  it('turns left-handed when another tab does', () => {
    const { left, values, otherTab } = setting();
    values[leftHandedKey] = '1';
    otherTab(leftHandedKey);
    expect(left.value).toBe(true);
  });

  it('turns right-handed again when another tab clears storage', () => {
    const { left, values, otherTab } = setting({ [leftHandedKey]: '1' });
    delete values[leftHandedKey];
    otherTab(null);
    expect(left.value).toBe(false);
  });

  it('stays as set where storage is blocked, whatever else another tab changes', () => {
    const tabs = new EventTarget();
    const left = new DeviceSetting(leftHandedSetting, storage({}, true), tabs);
    left.set(true);
    tabs.dispatchEvent(Object.assign(new Event('storage'), { key: 'bandmate.palette' }));
    expect(left.value).toBe(true);
  });
});
