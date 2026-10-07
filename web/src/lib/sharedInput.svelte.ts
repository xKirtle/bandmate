import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { inputSetting } from './inputSettings';

// The Input chosen on this device, shared by the recording settings,
// calibration and recording itself, so one chosen in any of this device's
// tabs is the one every open Song records from next.

export const input = new DeviceSetting(inputSetting, deviceStorage(), window);
