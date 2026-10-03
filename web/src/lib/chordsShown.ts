// Whether Read mode shows a Song's Chords. Hiding them is a choice about how
// the sheet is read, not an edit: it's kept on this device, for each Song,
// rather than saved with it. Chords show unless hidden for that Song here.

import { SvelteMap } from 'svelte/reactivity';
import { deviceStorage } from './timelineHeight';

/** Where hiding a Song's Chords is kept on this device. */
export function chordsHiddenKey(songId: number): string {
  return `bandmate.chordsHidden.${songId}`;
}

/** Whether a Song's Chords show on this device. */
export function readChordsShown(storage: Storage | undefined, songId: number): boolean {
  try {
    return storage?.getItem(chordsHiddenKey(songId)) == null;
  } catch {
    return true;
  }
}

/** Keeps whether a Song's Chords show on this device, forgetting it once they show again. */
export function storeChordsShown(storage: Storage | undefined, songId: number, shown: boolean) {
  try {
    if (shown) storage?.removeItem(chordsHiddenKey(songId));
    else storage?.setItem(chordsHiddenKey(songId), '1');
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

// Whether each Song's Chords show on this device, shared beyond the Lyric
// Sheet, which hides and shows them, so the Song page can read it too.

const changed = new SvelteMap<number, boolean>();

export const songChordsShown = {
  /** Whether a Song's Chords show on this device. */
  of: (songId: number): boolean => changed.get(songId) ?? readChordsShown(deviceStorage(), songId),
  /** Shows or hides a Song's Chords on this device. */
  set(songId: number, shown: boolean) {
    changed.set(songId, shown);
    storeChordsShown(deviceStorage(), songId, shown);
  },
};
