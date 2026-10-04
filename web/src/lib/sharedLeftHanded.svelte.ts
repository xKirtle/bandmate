import { readLeftHanded, storeLeftHanded } from './leftHanded';
import { deviceStorage } from './timelineHeight';

// Whether this device is left-handed, shared by every diagram and Name it's
// fretboard, so turning it on mirrors the ones showing.

let on = $state(readLeftHanded(deviceStorage()));

export const leftHanded = {
  /** Whether diagrams are mirrored on this device. */
  get on(): boolean {
    return on;
  },
  /** Mirrors diagrams on this device, or stops. */
  set(value: boolean) {
    on = value;
    storeLeftHanded(deviceStorage(), value);
  },
};
