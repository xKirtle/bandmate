import { DeviceSetting } from './deviceSetting.svelte';
import { lyricSizeSetting } from './lyricSize';
import { deviceStorage } from './timelineHeight';

// Read mode's Lyric Size on this device, shared by every Song, so a size
// set in one of this device's tabs shows in all of them.

export const lyricSize = new DeviceSetting(lyricSizeSetting, deviceStorage(), window);
