import { describe, expect, it } from 'vitest';
import { instrumentKey, instrumentText, readInstrument, storeInstrument } from './deviceInstrument';
import { storage } from './storageFake';

describe("the device's Instrument", () => {
  it('is the guitar until another is picked on this device, or without storage, or when it is blocked', () => {
    expect(readInstrument(storage())).toBe('guitar');
    expect(readInstrument(undefined)).toBe('guitar');
    expect(readInstrument(storage({}, true))).toBe('guitar');
  });

  it('keeps the Instrument picked, to read back after a reload', () => {
    const s = storage();
    storeInstrument(s, 'piano');
    expect(readInstrument(s)).toBe('piano');
  });

  it('is kept where the Chord Finder kept it, so a choice made there carries over', () => {
    expect(readInstrument(storage({ 'bandmate.chordFinder.instrument': 'piano' }))).toBe('piano');
  });

  it('forgets the choice once back to the guitar', () => {
    const values: Record<string, string> = {};
    storeInstrument(storage(values), 'piano');
    storeInstrument(storage(values), 'guitar');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeInstrument(undefined, 'piano')).not.toThrow();
    expect(() => storeInstrument(storage({}, true), 'piano')).not.toThrow();
  });

  it('reads an Instrument it does not offer as the guitar', () => {
    for (const kept of ['keyboard', 'Piano', ''])
      expect(readInstrument(storage({ [instrumentKey]: kept })), kept).toBe('guitar');
  });

  it('is named as every picker of it shows it', () => {
    expect(instrumentText('guitar')).toBe('Guitar');
    expect(instrumentText('piano')).toBe('Piano');
  });
});
