import { SvelteMap } from 'svelte/reactivity';
import { readAutoScrollSpeed, storeAutoScrollSpeed } from './autoScrollSpeed';
import { deviceStorage } from './deviceStorage';

// Each Song's Auto-scroll speed on this device, shared between the Reading
// menu and Auto-scroll's pill and keys, which all change it.

const changed = new SvelteMap<number, number>();

export const songAutoScrollSpeed = {
  /** How fast Auto-scroll goes for a Song on this device, as a level from 1 to 10. */
  of: (songId: number): number => changed.get(songId) ?? readAutoScrollSpeed(deviceStorage(), songId),
  /** Sets how fast Auto-scroll goes for a Song on this device. */
  set(songId: number, level: number) {
    changed.set(songId, level);
    storeAutoScrollSpeed(deviceStorage(), songId, level);
  },
};
