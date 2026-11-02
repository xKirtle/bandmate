import { describe, expect, it } from 'vitest';
import { deviceTuningKey, readDeviceTuning, storeDeviceTuning } from './deviceTuning';
import { storage } from './storageFake';

describe('the device’s Tuning', () => {
  it('is the one the Chord Finder kept before the Tuner shared it, under the same key', () => {
    expect(readDeviceTuning(storage({ 'bandmate.chordFinder.tuning': 'Open G' }))).toBe('Open G');
  });

  it('is standard tuning until picked on this device', () => {
    expect(readDeviceTuning(storage())).toBe('Standard');
  });

  it('is standard tuning without storage, or when it is blocked', () => {
    expect(readDeviceTuning(undefined)).toBe('Standard');
    expect(readDeviceTuning(storage({}, true))).toBe('Standard');
  });

  it('keeps the tuning picked, to read back after a reload', () => {
    const s = storage();
    storeDeviceTuning(s, 'Drop D');
    expect(readDeviceTuning(s)).toBe('Drop D');
  });

  it('keeps a custom tuning as its six notes', () => {
    const s = storage();
    storeDeviceTuning(s, 'C G D G B D');
    expect(readDeviceTuning(s)).toBe('C G D G B D');
  });

  it('forgets the choice once back to standard tuning', () => {
    const values: Record<string, string> = {};
    storeDeviceTuning(storage(values), 'Open G');
    storeDeviceTuning(storage(values), 'Standard');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeDeviceTuning(undefined, 'Drop D')).not.toThrow();
    expect(() => storeDeviceTuning(storage({}, true), 'Drop D')).not.toThrow();
  });

  it('reads a tuning it can no longer read as standard tuning', () => {
    expect(readDeviceTuning(storage({ [deviceTuningKey]: 'Nashville' }))).toBe('Standard');
  });
});

describe('a capo kept from before', () => {
  // The Chord Finder once had a capo, kept on each device under this key.
  const capoKey = 'bandmate.chordFinder.capo';

  it('is deleted when the tuning is read, which still reads the kept tuning', () => {
    const values: Record<string, string> = { [deviceTuningKey]: 'Drop D', [capoKey]: '3' };
    expect(readDeviceTuning(storage(values))).toBe('Drop D');
    expect(values).toEqual({ [deviceTuningKey]: 'Drop D' });
  });

  it('is deleted when no tuning is kept too', () => {
    const values: Record<string, string> = { [capoKey]: '5' };
    expect(readDeviceTuning(storage(values))).toBe('Standard');
    expect(values).toEqual({});
  });
});
