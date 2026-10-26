// The Chord Finder's Instrument, its tuning and the Key Suggest suggests
// from. The user picks them on the Finder's page, and the last ones picked
// are kept on this device, like hiding a Song's Chords: the guitar, standard
// tuning and C major until picked here. The Instrument is the device's, which
// the Chord Chart draws too.

import { instruments, keys, tunings, tuningText, type InstrumentName } from './chordFinder';
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/** Where the device's Instrument is kept on this device: under the Chord Finder's name, where it was first picked. */
export const finderInstrumentKey = 'bandmate.chordFinder.instrument';
const defaultInstrument = instruments[0];

/** The Instrument last picked on this device, or the guitar. */
export function readFinderInstrument(storage: Storage | undefined): InstrumentName {
  try {
    const kept = storage?.getItem(finderInstrumentKey);
    return instruments.find((i) => i === kept) ?? defaultInstrument;
  } catch {
    return defaultInstrument;
  }
}

/** Keeps the Instrument picked on this device, forgetting it once back to the guitar. */
export function storeFinderInstrument(storage: Storage | undefined, instrument: InstrumentName) {
  try {
    if (instrument === defaultInstrument) storage?.removeItem(finderInstrumentKey);
    else storage?.setItem(finderInstrumentKey, instrument);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** The device's Instrument, shared by the Chord Finder and the Chord Chart, kept the way a Device Setting is. */
export const instrumentSetting = {
  key: finderInstrumentKey,
  read: readFinderInstrument,
  store: storeFinderInstrument,
} satisfies DeviceSettingStorage<InstrumentName>;

/** Where the Chord Finder's tuning is kept on this device. */
export const finderTuningKey = 'bandmate.chordFinder.tuning';
/** Where the Chord Finder kept its capo on this device, before the Chord Finder dropped its capo. */
const formerCapoKey = 'bandmate.chordFinder.capo';
const standard = tunings[0];

/**
 * The tuning last picked on this device, as a Song's Details write it, or
 * standard tuning. Reading it also deletes a capo kept from before the
 * Chord Finder dropped its capo.
 */
export function readFinderTuning(storage: Storage | undefined): string {
  try {
    storage?.removeItem(formerCapoKey);
    return tuningText(storage?.getItem(finderTuningKey) ?? '') ?? standard;
  } catch {
    return standard;
  }
}

/** Keeps the tuning picked on this device, forgetting it once back to standard tuning. */
export function storeFinderTuning(storage: Storage | undefined, tuning: string) {
  try {
    if (tuning === standard) storage?.removeItem(finderTuningKey);
    else storage?.setItem(finderTuningKey, tuning);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** Where the Key the Chord Finder's Suggest suggests from is kept on this device. */
export const finderKeyKey = 'bandmate.chordFinder.key';
const defaultKey = keys[0];

/** The Key last picked for Suggest on this device, as the picker writes it (G, Em), or C major. */
export function readFinderKey(storage: Storage | undefined): string {
  try {
    const kept = storage?.getItem(finderKeyKey);
    return kept && keys.includes(kept) ? kept : defaultKey;
  } catch {
    return defaultKey;
  }
}

/** Keeps the Key picked for Suggest on this device, forgetting it once back to C major. */
export function storeFinderKey(storage: Storage | undefined, key: string) {
  try {
    if (key === defaultKey) storage?.removeItem(finderKeyKey);
    else storage?.setItem(finderKeyKey, key);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
