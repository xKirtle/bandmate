import { describe, expect, it } from 'vitest';
import { storage } from './storageFake';
import { readTunerInput, storeTunerInput, tunerInputKey } from './tunerInput';

const second = { deviceId: 'scarlett', label: 'Scarlett 2i2 USB', channel: 1 };

describe('the Tuner’s Input, kept on this device', () => {
  it('is none picked until one is kept, so it’s the Input recorded from', () => {
    expect(readTunerInput(storage())).toBeNull();
  });

  it('is the Input last picked, kept across reloads', () => {
    const values: Record<string, string> = {};
    storeTunerInput(storage(values), second);
    expect(readTunerInput(storage(values))).toEqual(second);
  });

  it('is kept apart from the Input recorded from', () => {
    const values: Record<string, string> = {};
    storeTunerInput(storage(values), second);
    expect(Object.keys(values)).toEqual([tunerInputKey]);
    expect(tunerInputKey).not.toBe('bandmate.input');
  });

  it('is none picked where what’s kept can’t be read', () => {
    for (const kept of ['not json', '{"deviceId":3,"channel":0}', '{"deviceId":"x","channel":-1}', 'null']) {
      expect(readTunerInput(storage({ [tunerInputKey]: kept }))).toBeNull();
    }
  });

  it('is none picked, and picking still works till reload, where the browser refuses storage', () => {
    expect(readTunerInput(storage({}, true))).toBeNull();
    expect(() => storeTunerInput(storage({}, true), second)).not.toThrow();
  });
});
