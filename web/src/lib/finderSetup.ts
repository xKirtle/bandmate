// The Chord Finder's tuning and the Key Suggest suggests from. The user picks
// them on the Finder's page, and the last ones picked are kept on this
// device, like hiding a Song's Chords: standard tuning and C major until
// picked here.

import { keys, tunings, tuningText } from './chordFinder';

/** Where the Chord Finder's tuning is kept on this device. */
export const finderTuningKey = 'bandmate.chordFinder.tuning';
/** Where the Chord Finder kept its capo on this device, before it lost it. */
const formerCapoKey = 'bandmate.chordFinder.capo';
const standard = tunings[0];

/**
 * The tuning last picked on this device, as a Song's Details write it, or
 * standard tuning. A capo kept from before the Finder lost it is deleted.
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
