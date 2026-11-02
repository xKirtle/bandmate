// The Key the Chord Finder's Suggest suggests from. The user picks it on the
// Finder's page, and the last one picked is kept on this device, like hiding
// a Song's Chords: C major until picked here. Its Instrument is the device's
// (deviceInstrument.ts), and so is its Tuning (deviceTuning.ts).

import { keys } from './chordFinder';

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
