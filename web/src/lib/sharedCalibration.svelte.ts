import { deviceStorage } from './deviceStorage';
import { InputCalibrations } from './inputCalibrations';

// Each Input's Latency Offset calibrated on this device, and whether
// calibration was offered for it yet, shared by every open Song, so one
// calibrated or skipped in any of this device's tabs places the next Take
// from that Input, or isn't offered again, in all of them.

export const calibrations = new InputCalibrations(deviceStorage(), window);
