import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { writingAidsSetting } from './writingAids';

// Whether Write mode shows its writing aids, shared by the Lyric Sheet's
// toggle, Settings, and the Song page, which shows Rhymes, so turning them
// off anywhere, in any of this device's tabs, hides them.

export const writingAids = new DeviceSetting(writingAidsSetting, deviceStorage(), window);
