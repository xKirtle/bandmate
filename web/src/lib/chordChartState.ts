// Whether Read mode's Chord Chart is shown, and whether it's pinned (staying
// at the top as the Lyric Sheet scrolls) rather than scrolling away with it:
// two choices, so a pinned Chart that's hidden comes back pinned. How a
// player reads Chords is about them, not any Song: both are kept on this
// device, for every Song, and the Chart shows, unpinned, until set otherwise
// here.

/** The Chord Chart's state: whether it's shown, and whether it's pinned. */
export type ChordChartState = { shown: boolean; pinned: boolean };

/** The Chord Chart's state until set otherwise, and without storage. */
const byDefault: ChordChartState = { shown: true, pinned: false };

/** Where the Chord Chart's state is kept on this device. */
export const chordChartStateKey = 'bandmate.chordChart';

// How each state other than the default is kept: one value, so what the old
// hidden / shown / pinned choice kept still reads as it did.
const kept = {
  hidden: { shown: false, pinned: false },
  pinned: { shown: true, pinned: true },
  'hidden-pinned': { shown: false, pinned: true },
} satisfies Record<string, ChordChartState>;

/** The Chord Chart's state on this device. */
export function readChordChartState(storage: Storage | undefined): ChordChartState {
  try {
    const value = storage?.getItem(chordChartStateKey);
    const state = Object.entries(kept).find(([key]) => key === value)?.[1];
    return { ...(state ?? byDefault) };
  } catch {
    return { ...byDefault };
  }
}

/** Keeps the Chord Chart's state on this device, forgetting it once back to the default. */
export function storeChordChartState(storage: Storage | undefined, state: ChordChartState) {
  try {
    const value = Object.entries(kept).find(([, s]) => s.shown === state.shown && s.pinned === state.pinned)?.[0];
    if (value) storage?.setItem(chordChartStateKey, value);
    else storage?.removeItem(chordChartStateKey);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
