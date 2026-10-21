import { describe, expect, it } from 'vitest';
import { DeviceSetting, type DeviceSettingStorage } from './deviceSetting.svelte';
import { choose, keysIn, shortcutKeysKey, shortcutKeysSetting, storeShortcutKeys } from './shortcutKeys';

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

// A stand-in setting, so these cases are the module's own and not any one
// setting's: a whole number kept under one key, 1 until kept here, and 1
// again where what's kept can't be read.
const standInKey = 'bandmate.standIn';
const standInDefault = 1;
const otherKey = 'bandmate.palette';

function standInStorage(shown?: (value: number) => void): DeviceSettingStorage<number> {
  return {
    key: standInKey,
    read: (store) => {
      try {
        const kept = Number(store?.getItem(standInKey));
        return Number.isInteger(kept) && kept > 0 ? kept : standInDefault;
      } catch {
        return standInDefault;
      }
    },
    store: (store, value) => {
      try {
        store?.setItem(standInKey, String(value));
      } catch {
        // Not kept, e.g. in a private window; the value still applies until reload.
      }
    },
    ...(shown ? { shown } : {}),
  };
}

/** The stand-in setting as the app keeps it, in a stand-in Storage this device's other tabs share. */
function setting(values: Record<string, string> = {}, blocked = false, shown?: (value: number) => void) {
  const tabs = new EventTarget();
  const kept = new DeviceSetting(standInStorage(shown), storage(values, blocked), tabs);
  /** Another tab keeps a value, or clears storage with a null key, as the browser tells this one. */
  const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
  return { kept, values, otherTab };
}

describe('A Device Setting, reading and keeping its value', () => {
  it('is the value in this device storage, read as the setting reads it', () => {
    expect(setting({ [standInKey]: '7' }).kept.value).toBe(7);
  });

  it('falls back to the default until a value is kept on this device', () => {
    expect(setting().kept.value).toBe(standInDefault);
  });

  it("falls back to the default when what's kept can't be read", () => {
    expect(setting({ [standInKey]: 'nope' }).kept.value).toBe(standInDefault);
  });

  it('is the value set, and keeps it to read back after a reload', () => {
    const { kept, values } = setting();
    kept.set(7);
    expect(kept.value).toBe(7);
    expect(setting(values).kept.value).toBe(7);
  });
});

describe("A Device Setting, following this device's other tabs", () => {
  it('picks up another tab keeping this setting', () => {
    const { kept, values, otherTab } = setting();
    values[standInKey] = '7';
    otherTab(standInKey);
    expect(kept.value).toBe(7);
  });

  it('ignores another tab keeping another setting', () => {
    const { kept, values, otherTab } = setting({ [standInKey]: '7' });
    values[standInKey] = '9';
    otherTab(otherKey);
    expect(kept.value).toBe(7);
  });

  it('re-reads, and so falls back, when another tab clears storage', () => {
    const { kept, values, otherTab } = setting({ [standInKey]: '7' });
    delete values[standInKey];
    otherTab(null);
    expect(kept.value).toBe(standInDefault);
  });
});

describe("A Device Setting's hook for showing the value", () => {
  /** The stand-in setting with a hook, and every value it was told to show, in order. */
  function withShown(values: Record<string, string> = {}) {
    const shown: number[] = [];
    return { ...setting(values, false, (value) => shown.push(value)), shown };
  }

  it('shows the value read on construction', () => {
    expect(withShown({ [standInKey]: '7' }).shown).toEqual([7]);
  });

  it('shows the value set', () => {
    const { kept, shown } = withShown();
    kept.set(7);
    expect(shown).toEqual([standInDefault, 7]);
  });

  it("shows the value another tab's change to this setting brings in", () => {
    const { values, otherTab, shown } = withShown();
    values[standInKey] = '7';
    otherTab(standInKey);
    expect(shown).toEqual([standInDefault, 7]);
  });

  it('shows the value a cleared storage falls back to', () => {
    const { values, otherTab, shown } = withShown({ [standInKey]: '7' });
    delete values[standInKey];
    otherTab(null);
    expect(shown).toEqual([7, standInDefault]);
  });

  it('shows nothing when another tab keeps another setting', () => {
    const { otherTab, shown } = withShown({ [standInKey]: '7' });
    otherTab(otherKey);
    expect(shown).toEqual([7]);
  });
});

// The Shortcuts' keys are the one setting whose following was promised in
// prose alone: a key rebound in any of this device's tabs is used and named
// in all of them.
describe("The Shortcuts' keys, as the Device Setting holds them", () => {
  it("follows a Shortcut rebound in another of this device's tabs", () => {
    const values: Record<string, string> = {};
    const tabs = new EventTarget();
    const keys = new DeviceSetting(shortcutKeysSetting, storage(values), tabs);
    expect(keysIn(keys.value.keys, 'record', 'keys')).toEqual([{ key: 'r' }]);

    // Another tab gives Record Q in place of R, and keeps it.
    const rebound = choose(keys.value, { id: 'record', list: 'keys', index: 0 }, { key: 'q' });
    if (!rebound.ok) throw new Error('Q was refused for Record');
    storeShortcutKeys(storage(values), rebound.keys);
    tabs.dispatchEvent(Object.assign(new Event('storage'), { key: shortcutKeysKey }));

    expect(keysIn(keys.value.keys, 'record', 'keys')).toEqual([{ key: 'q' }]);
  });
});

describe('A Device Setting where storage is refused', () => {
  it('falls back to the default', () => {
    expect(setting({}, true).kept.value).toBe(standInDefault);
  });

  it('is the value set, kept in memory alone, whatever else another tab changes', () => {
    const { kept, otherTab } = setting({}, true);
    expect(() => kept.set(7)).not.toThrow();
    expect(kept.value).toBe(7);
    otherTab(otherKey);
    expect(kept.value).toBe(7);
  });
});
