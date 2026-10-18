import { chartSizeSetting } from './chartSize';
import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';

// Read mode's Chart Size on this device, shared by every Song, so a size
// set in one of this device's tabs shows in all of them.

export const chartSize = new DeviceSetting(chartSizeSetting, deviceStorage(), window);
