import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { followKeys, shortcutKeysSetting } from './shortcutKeys';

// The Shortcuts' keys on this device, shared by Settings' Shortcuts tab,
// which rebinds them, and every handler and hint on the Song page, which
// ask `rebound` for them: a key changed in any of this device's tabs is
// used and named in all of them at once.

export const shortcutKeys = new DeviceSetting(shortcutKeysSetting, deviceStorage(), window);

followKeys(() => shortcutKeys.value.keys);
