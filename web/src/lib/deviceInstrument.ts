// The device's Instrument, a Device Setting: the one the Chord Finder plays
// and the Chord Chart and a Chord's popover draw, the guitar until another is
// picked. It's picked in the Chord Finder, Read mode's Reading menu or
// Settings' This device, and kept on this device, whatever the Song.

import { instruments, type InstrumentName } from './chordFinder';
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/**
 * Where the device's Instrument is kept on this device: under the Chord
 * Finder's name, where it was first picked, so a choice made there carries over.
 */
export const instrumentKey = 'bandmate.chordFinder.instrument';
const defaultInstrument = instruments[0];

/** The Instrument last picked on this device, or the guitar. */
export function readInstrument(storage: Storage | undefined): InstrumentName {
  try {
    const kept = storage?.getItem(instrumentKey);
    return instruments.find((i) => i === kept) ?? defaultInstrument;
  } catch {
    return defaultInstrument;
  }
}

/** Keeps the Instrument picked on this device, forgetting it once back to the guitar. */
export function storeInstrument(storage: Storage | undefined, instrument: InstrumentName) {
  try {
    if (instrument === defaultInstrument) storage?.removeItem(instrumentKey);
    else storage?.setItem(instrumentKey, instrument);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** The device's Instrument, as a Device Setting is kept on this device. */
export const instrumentSetting = {
  key: instrumentKey,
  read: readInstrument,
  store: storeInstrument,
} satisfies DeviceSettingStorage<InstrumentName>;

/** An Instrument's name, as every picker of it shows it. */
export function instrumentText(instrument: InstrumentName): string {
  return instrument === 'piano' ? 'Piano' : 'Guitar';
}
