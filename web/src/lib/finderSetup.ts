// The standalone Chord Finder's tuning and capo. With no Song to follow, the
// user picks them, and the last ones picked are kept on this device, like
// hiding a Song's Chords: standard tuning and no capo until picked here.

import { tunings, tuningText } from './chordFinder';

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
