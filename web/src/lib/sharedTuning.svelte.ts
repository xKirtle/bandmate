import { deviceStorage } from './deviceStorage';
import { readDeviceTuning, storeDeviceTuning } from './deviceTuning';

// The device's Tuning, shared by the Chord Finder and the Tuner, so one
// picked on either page is the other's too, and held for the session, so it
// carries between them even where it can't be kept.

let tuning = $state(readDeviceTuning(deviceStorage()));

export const deviceTuning = {
  /** The device's Tuning, as a Song's Details write it: standard tuning until picked. */
  get value(): string {
    return tuning;
  },
  /** Picks the device's Tuning, and keeps it on this device. */
  set(picked: string) {
    tuning = picked;
    storeDeviceTuning(deviceStorage(), picked);
  },
};
