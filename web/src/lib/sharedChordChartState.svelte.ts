import { readChordChartState, storeChordChartState, type ChordChartState } from './chordChartState';
import { deviceStorage } from './timelineHeight';

// The Chord Chart's state on this device, held for the session too, so the
// choice carries from Song to Song even where it can't be kept.

let state = $state(readChordChartState(deviceStorage()));

export const chordChartState = {
  /** Whether the Chord Chart is hidden, shown or pinned on this device. */
  get current(): ChordChartState {
    return state;
  },
  /** Hides, shows or pins the Chord Chart on this device. */
  set(value: ChordChartState) {
    state = value;
    storeChordChartState(deviceStorage(), value);
  },
};
