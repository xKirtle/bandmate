// Whether Chord diagrams are mirrored for a left-handed player, the high
// string on the left, and the Tuner's headstock, the low strings on the
// right. A choice about how they're drawn, not about any Song: it's kept on this device, and is off until set here.
import type { DeviceSettingStorage } from './deviceSetting.svelte';

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

/** Left-handed, as a Device Setting is kept on this device. */
export const leftHandedSetting = {
  key: leftHandedKey,
  read: readLeftHanded,
  store: storeLeftHanded,
} satisfies DeviceSettingStorage<boolean>;
