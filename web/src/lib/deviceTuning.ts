// The device's Tuning (see the glossary): one per device, shared by the Chord
// Finder and the Tuner, so picking one in either changes it for both:
// standard tuning until another is picked. It's remembered, like hiding a
// Song's Chords, not a Device Setting. A Song's tuning is its own.

import { tunings, tuningText } from './chordFinder';

/**
 * Where the device's Tuning is kept on this device: under the Chord Finder's
 * name, where it was first picked, so a Tuning picked there carries over.
 */
export const deviceTuningKey = 'bandmate.chordFinder.tuning';
/** Where the Chord Finder kept its capo on this device, before the Chord Finder dropped its capo. */
const formerCapoKey = 'bandmate.chordFinder.capo';
const standard = tunings[0];

/**
 * The Tuning last picked on this device, as a Song's Details write it, or
 * standard tuning. Reading it also deletes a capo kept from before the
 * Chord Finder dropped its capo.
 */
export function readDeviceTuning(storage: Storage | undefined): string {
  try {
    storage?.removeItem(formerCapoKey);
    return tuningText(storage?.getItem(deviceTuningKey) ?? '') ?? standard;
  } catch {
    return standard;
  }
}

/** Keeps the Tuning picked on this device, forgetting it once back to standard tuning. */
export function storeDeviceTuning(storage: Storage | undefined, tuning: string) {
  try {
    if (tuning === standard) storage?.removeItem(deviceTuningKey);
    else storage?.setItem(deviceTuningKey, tuning);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
