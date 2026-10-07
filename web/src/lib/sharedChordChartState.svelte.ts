import { readChordChartState, storeChordChartState, type ChordChartState } from './chordChartState';
import { deviceStorage } from './deviceStorage';

// The Chord Chart's state on this device, held for the session too, so the
// choice carries from Song to Song even where it can't be kept.

let state = $state(readChordChartState(deviceStorage()));

export const chordChartState = {
  /** Whether the Chord Chart is shown, and whether it's pinned, on this device. */
  get current(): ChordChartState {
    return state;
  },
  /** Shows or hides the Chord Chart on this device, keeping whether it's pinned. */
  setShown(shown: boolean) {
    state = { ...state, shown };
    storeChordChartState(deviceStorage(), state);
  },
  /** Pins or unpins the Chord Chart on this device. */
  setPinned(pinned: boolean) {
    state = { ...state, pinned };
    storeChordChartState(deviceStorage(), state);
  },
};
