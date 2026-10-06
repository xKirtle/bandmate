import { describe, expect, it } from 'vitest';
import { DeviceSetting } from './deviceSetting.svelte';
import {
  channelName,
  deviceName,
  inputKey,
  inputSetting,
  meterLevel,
  readInput,
  resolveInput,
  storeInput,
} from './inputSettings';

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

const scarlett = { deviceId: 'abc', label: 'Scarlett 2i2 USB (1235:8210)' };
const laptop = { deviceId: 'def', label: 'Built-in Microphone' };

describe('readInput and storeInput', () => {
  it('is the default input, Input 1, the first time', () => {
    expect(readInput(storage())).toEqual({ deviceId: '', label: '', channel: 0 });
  });

  it('remembers the input chosen on this device', () => {
    const s = storage();
    storeInput(s, { deviceId: 'abc', label: 'Scarlett 2i2', channel: 1 });
    expect(readInput(s)).toEqual({ deviceId: 'abc', label: 'Scarlett 2i2', channel: 1 });
  });

  it('is the default when what is kept is unreadable', () => {
    expect(readInput(storage({ [inputKey]: '{nope' }))).toEqual({ deviceId: '', label: '', channel: 0 });
    expect(readInput(storage({ [inputKey]: '{"deviceId":3,"channel":-1}' }))).toEqual({
      deviceId: '',
      label: '',
      channel: 0,
    });
  });

  it('is the default, and keeps nothing, when storage is blocked', () => {
    const s = storage({}, true);
    storeInput(s, { deviceId: 'abc', label: 'Scarlett 2i2', channel: 1 });
    expect(readInput(s)).toEqual({ deviceId: '', label: '', channel: 0 });
  });
});

describe("The Input's Device Setting", () => {
  /** The Input as the app keeps it, in a stand-in Storage this device's other tabs share. */
  function setting(values: Record<string, string> = {}, blocked = false) {
    const tabs = new EventTarget();
    const input = new DeviceSetting(inputSetting, storage(values, blocked), tabs);
    /** Another tab keeps a value, or clears storage with a null key, as the browser tells this one. */
    const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { input, values, otherTab };
  }

  const defaultInput = { deviceId: '', label: '', channel: 0 };
  const scarlettInput2 = { deviceId: 'abc', label: 'Scarlett 2i2', channel: 1 };

  it('is the default input, Input 1, until one is chosen on this device', () => {
    expect(setting().input.value).toEqual(defaultInput);
  });

  it('is the default input when storage is blocked', () => {
    expect(setting({}, true).input.value).toEqual(defaultInput);
  });

  it('keeps the Input chosen, to read back after a reload', () => {
    const { input, values } = setting();
    input.set(scarlettInput2);
    expect(input.value).toEqual(scarlettInput2);
    expect(setting(values).input.value).toEqual(scarlettInput2);
  });

  it('is the Input another tab chooses', () => {
    const { input, values, otherTab } = setting();
    values[inputKey] = JSON.stringify(scarlettInput2);
    otherTab(inputKey);
    expect(input.value).toEqual(scarlettInput2);
  });

  it('is the default input again when another tab clears storage', () => {
    const { input, values, otherTab } = setting({ [inputKey]: JSON.stringify(scarlettInput2) });
    delete values[inputKey];
    otherTab(null);
    expect(input.value).toEqual(defaultInput);
  });

  it('stays as chosen where storage is blocked, whatever else another tab changes', () => {
    const { input, otherTab } = setting({}, true);
    input.set(scarlettInput2);
    otherTab('bandmate.palette');
    expect(input.value).toEqual(scarlettInput2);
  });
});

describe('resolveInput', () => {
  it('is the remembered input while it is connected', () => {
    expect(resolveInput([laptop, scarlett], { deviceId: 'abc', label: 'Scarlett 2i2', channel: 1 }, 2)).toEqual({
      deviceId: 'abc',
      channel: 1,
      gone: null,
    });
  });

  it('is the default input without one chosen', () => {
    expect(resolveInput([laptop], { deviceId: '', label: '', channel: 0 }, 1)).toEqual({
      deviceId: '',
      channel: 0,
      gone: null,
    });
  });

  it('falls back to the default input, and names the one gone', () => {
    expect(resolveInput([laptop], { deviceId: 'abc', label: 'Scarlett 2i2 USB (1235:8210)', channel: 1 }, 2)).toEqual({
      deviceId: '',
      channel: 0,
      gone: 'Scarlett 2i2 USB',
    });
  });

  it('falls back to Input 1 when the input has fewer channels than the one chosen', () => {
    expect(resolveInput([scarlett], { deviceId: 'abc', label: '', channel: 1 }, 1)).toEqual({
      deviceId: 'abc',
      channel: 0,
      gone: null,
    });
    expect(resolveInput([scarlett], { deviceId: 'abc', label: '', channel: 1 }, 2).channel).toBe(1);
  });
});

describe('deviceName and channelName', () => {
  it('drops the USB ids a browser adds to a label', () => {
    expect(deviceName('Scarlett 2i2 USB (1235:8210)')).toBe('Scarlett 2i2 USB');
    expect(deviceName('Built-in Microphone')).toBe('Built-in Microphone');
  });

  it('names an input without a label', () => {
    expect(deviceName('')).toBe('Unnamed input');
  });

  it('names a channel after its device, counting from 1', () => {
    expect(channelName('Scarlett 2i2 USB (1235:8210)', 0)).toBe('Scarlett 2i2 USB · Input 1');
    expect(channelName('Scarlett 2i2 USB (1235:8210)', 1)).toBe('Scarlett 2i2 USB · Input 2');
  });
});

describe('meterLevel', () => {
  it('is empty for silence', () => {
    expect(meterLevel(new Float32Array(128))).toEqual({ fill: 0, clipped: false });
  });

  it('is full at full scale, which clips', () => {
    expect(meterLevel(Float32Array.of(0, -1, 0.2))).toEqual({ fill: 1, clipped: true });
  });

  it('fills by decibels, from -60 dB up', () => {
    // -6 dB and -30 dB, whichever sign the peak has.
    expect(meterLevel(Float32Array.of(0.1, -0.5012)).fill).toBeCloseTo(0.9, 3);
    expect(meterLevel(Float32Array.of(0.03162)).fill).toBeCloseTo(0.5, 3);
    expect(meterLevel(Float32Array.of(0.0001)).fill).toBe(0);
  });

  it('clips just short of full scale, where an interface already has', () => {
    expect(meterLevel(Float32Array.of(0.999)).clipped).toBe(true);
    expect(meterLevel(Float32Array.of(0.98)).clipped).toBe(false);
  });
});
