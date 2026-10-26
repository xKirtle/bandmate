import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { instrumentSetting } from './finderSetup';

// The device's Instrument, shared by the Chord Finder, the Chord Chart and a
// Chord's popover, so picking one in any of them, in any of this device's
// tabs, changes it in all of them: the guitar until another is picked.

export const instrument = new DeviceSetting(instrumentSetting, deviceStorage(), window);
