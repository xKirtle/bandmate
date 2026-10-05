// Whether Read mode's Chord Chart is hidden, shown (scrolling away with the
// Lyric Sheet) or pinned (staying at the top as it scrolls). How a player
// reads Chords is about them, not any Song: it's kept on this device, for
// every Song, and the Chart shows until set otherwise here.

/** The Chord Chart's states. */
export const chordChartStates = ['hidden', 'shown', 'pinned'] as const;
export type ChordChartState = (typeof chordChartStates)[number];

/** Where the Chord Chart's state is kept on this device. */
export const chordChartStateKey = 'bandmate.chordChart';

/** The Chord Chart's state on this device. */
export function readChordChartState(storage: Storage | undefined): ChordChartState {
  try {
    const kept = storage?.getItem(chordChartStateKey);
    return chordChartStates.find((state) => state === kept) ?? 'shown';
  } catch {
    return 'shown';
  }
}

/** Keeps the Chord Chart's state on this device, forgetting it once shown again. */
export function storeChordChartState(storage: Storage | undefined, state: ChordChartState) {
  try {
    if (state === 'shown') storage?.removeItem(chordChartStateKey);
    else storage?.setItem(chordChartStateKey, state);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
