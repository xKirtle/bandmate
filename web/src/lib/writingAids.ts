// Whether Write mode shows its writing aids: each Line's Syllable Count. A
// choice about how Bandmate works on this device, not about any Song: it's
// kept on this device, and is on until turned off here. While it's off, no
// Language's data is fetched.
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/** Where turning the writing aids off is kept on this device. */
export const writingAidsOffKey = 'bandmate.writingAidsOff';

/** Whether this device shows the writing aids. */
export function readWritingAids(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(writingAidsOffKey) == null;
  } catch {
    return true;
  }
}

/** Keeps whether this device shows the writing aids, forgetting it once they're on again. */
export function storeWritingAids(storage: Storage | undefined, on: boolean) {
  try {
    if (on) storage?.removeItem(writingAidsOffKey);
    else storage?.setItem(writingAidsOffKey, '1');
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** The writing aids, as a Device Setting is kept on this device. */
export const writingAidsSetting = {
  key: writingAidsOffKey,
  read: readWritingAids,
  store: storeWritingAids,
} satisfies DeviceSettingStorage<boolean>;
