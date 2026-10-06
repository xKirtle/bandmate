import { calibrationSetting } from './calibration';
import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './timelineHeight';

// The Latency Offset calibrated on this device, and whether calibration was
// offered yet, shared by every open Song, so one calibrated or skipped in
// any of this device's tabs places the next Take, or isn't offered again,
// in all of them.

export const calibration = new DeviceSetting(calibrationSetting, deviceStorage(), window);
