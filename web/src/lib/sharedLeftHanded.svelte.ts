import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { leftHandedSetting } from './leftHanded';

// Whether this device is left-handed, shared by every diagram, Name it's
// fretboard and the Tuner's headstock, and by Settings and the Chord Finder's toggle, so turning it on
// anywhere, in any of this device's tabs, mirrors the ones showing.

export const leftHanded = new DeviceSetting(leftHandedSetting, deviceStorage(), window);
