import { SvelteMap } from 'svelte/reactivity';
import { deviceStorage } from './timelineHeight';
import { readTranspose, storeTranspose } from './transposeAmount';

// Each Song's Transpose amount on this device, shared so the Lyric Sheet,
// which changes it, and the Song page, which shows the key it gives, agree.

const changed = new SvelteMap<number, number>();

export const transposeAmount = {
  /** How far a Song's Chords are transposed on this device, in semitones. */
  of: (songId: number): number => changed.get(songId) ?? readTranspose(deviceStorage(), songId),
  /** Transposes a Song's Chords by amount semitones on this device. */
  set(songId: number, amount: number) {
    changed.set(songId, amount);
    storeTranspose(deviceStorage(), songId, amount);
  },
};
