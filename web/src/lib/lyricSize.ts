// How large Read mode shows a Song's Lines, Chords and Labels, as a
// percentage of their usual sizes. Like Transpose, it's a way of reading the
// Song, not an edit; it's about how far away the device sits, so it's kept on
// this device for every Song, and is 100% until set here. Like Transpose,
// it's simply remembered, not a Device Setting listed in Settings, though
// it's kept the same way.
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/** The Lyric Sizes, in percent, from smallest to largest. */
export const lyricSizes = [80, 90, 100, 115, 130, 150, 175];

/** The Lyric Size the Lines, Chords and Labels usually show at, until set on this device. */
export const usualLyricSize = 100;

/** The smallest and largest Lyric Sizes. */
export const smallestLyricSize = lyricSizes[0];
export const largestLyricSize = lyricSizes[lyricSizes.length - 1];

/** Where the Lyric Size is kept on this device. */
export const lyricSizeKey = 'bandmate.lyricSize';

/** How large Read mode's Lyric Size shows the Lines, Chords and Labels: 100% unless set on this device. */
export function readLyricSize(storage: Storage | undefined): number {
  try {
    const size = Number(storage?.getItem(lyricSizeKey));
    return lyricSizes.includes(size) ? size : usualLyricSize;
  } catch {
    return usualLyricSize;
  }
}

/** Keeps the Lyric Size on this device, forgetting it once back to 100%. */
export function storeLyricSize(storage: Storage | undefined, size: number) {
  try {
    if (size === usualLyricSize) storage?.removeItem(lyricSizeKey);
    else storage?.setItem(lyricSizeKey, String(size));
  } catch {
    // Not kept, e.g. in a private window; the size still applies until reload.
  }
}

/** The Lyric Size a step larger (by 1) or smaller (by −1), held from 80% to 175%. */
export function stepLyricSize(size: number, by: number): number {
  const at = lyricSizes.indexOf(size) + by;
  return lyricSizes[Math.max(0, Math.min(lyricSizes.length - 1, at))];
}

/** The Lyric Size, kept on this device the way a Device Setting is. */
export const lyricSizeSetting = {
  key: lyricSizeKey,
  read: readLyricSize,
  store: storeLyricSize,
} satisfies DeviceSettingStorage<number>;
