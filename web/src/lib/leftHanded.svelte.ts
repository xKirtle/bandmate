// Whether Chord diagrams are mirrored for a left-handed player, the high
// string on the left. A choice about how diagrams are drawn, not about any
// Song: it's kept on this device, and is off until set here.

import { deviceStorage } from './timelineHeight';

/** Where being left-handed is kept on this device. */
export const leftHandedKey = 'bandmate.leftHanded';

/** Whether this device's diagrams are mirrored for a left-handed player. */
export function readLeftHanded(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(leftHandedKey) != null;
  } catch {
    return false;
  }
}

/** Keeps whether this device is left-handed, forgetting it once right-handed again. */
export function storeLeftHanded(storage: Storage | undefined, on: boolean) {
  try {
    if (on) storage?.setItem(leftHandedKey, '1');
    else storage?.removeItem(leftHandedKey);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

// Shared by every diagram, so turning it on mirrors the ones already showing.

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
