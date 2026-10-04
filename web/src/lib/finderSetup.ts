// The standalone Chord Finder's tuning, capo and the Key Suggest suggests
// from. With no Song to follow, the user picks them, and the last ones picked
// are kept on this device, like hiding a Song's Chords: standard tuning, no
// capo and C major until picked here.

import { keys, tunings, tuningText } from './chordFinder';

/** The highest fret the capo picker offers. */
export const capoLimit = 11;

/** The standalone Chord Finder's tuning, as a Song's Details write it, and capo, 0 for none. */
export interface FinderSetup {
  tuning: string;
  capo: number;
}

/** Where the standalone Chord Finder's tuning is kept on this device. */
export const finderTuningKey = 'bandmate.chordFinder.tuning';
/** Where the standalone Chord Finder's capo is kept on this device. */
export const finderCapoKey = 'bandmate.chordFinder.capo';
const standard = tunings[0];

/** The tuning and capo last picked on this device, or standard tuning and no capo. */
export function readFinderSetup(storage: Storage | undefined): FinderSetup {
  try {
    const tuning = tuningText(storage?.getItem(finderTuningKey) ?? '') ?? standard;
    const kept = storage?.getItem(finderCapoKey);
    const capo = kept ? Number(kept) : 0;
    return { tuning, capo: Number.isInteger(capo) && capo >= 0 && capo <= capoLimit ? capo : 0 };
  } catch {
    return { tuning: standard, capo: 0 };
  }
}

/** Keeps the tuning and capo picked on this device, forgetting each once back to standard tuning or no capo. */
export function storeFinderSetup(storage: Storage | undefined, setup: FinderSetup) {
  try {
    if (setup.tuning === standard) storage?.removeItem(finderTuningKey);
    else storage?.setItem(finderTuningKey, setup.tuning);
    if (setup.capo === 0) storage?.removeItem(finderCapoKey);
    else storage?.setItem(finderCapoKey, String(setup.capo));
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** Where the Key the standalone Chord Finder's Suggest suggests from is kept on this device. */
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
