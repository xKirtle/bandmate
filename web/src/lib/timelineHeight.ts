// How tall the Timeline's Tracks area is: fitting its Tracks up to
// defaultShare of the window, and dragged by its top edge up to mostShare. A
// dragged height is kept on this device as the least a Song's area starts at,
// and never taller than the window allows or the Tracks need.

/** Where the chosen height is kept on this device. */
export const heightKey = 'bandmate.timelineHeight';

/** The most of the window the Tracks area grows to fit its Tracks, and takes until one's chosen. */
export const defaultShare = 0.4;

/** The most of the window the Tracks area can take, leaving room for the page header. */
export const mostShare = 0.85;

/** The least and most the Tracks area can be, in pixels. */
export interface HeightBounds {
  min: number;
  max: number;
}

/** How tall the Tracks area is until one's chosen. */
export function defaultHeight(windowHeight: number): number {
  return windowHeight * defaultShare;
}

/**
 * The height to keep once the Tracks need `needed` instead of `neededBefore`
 * (0 while unknown). If every Track showed, it grows to show them all, up to
 * defaultShare of the window; if the area scrolled, it's left as it is.
 */
export function grownHeight(height: number, neededBefore: number, needed: number, windowHeight: number): number {
  // What's shown can't go past mostShare, however tall the height kept.
  const showedAll = Math.min(height, windowHeight * mostShare) >= neededBefore;
  if (needed <= neededBefore || !showedAll) return height;
  return Math.max(height, Math.min(needed, defaultHeight(windowHeight)));
}

/**
 * From one Track and the ruler to mostShare of the window, but no taller
 * than the Tracks need once that's known (not 0).
 */
export function heightBounds(windowHeight: number, oneTrack: number, needed: number): HeightBounds {
  const most = windowHeight * mostShare;
  return { min: oneTrack, max: Math.max(oneTrack, needed > 0 ? Math.min(most, needed) : most) };
}

/** A height kept within the bounds. */
export function clampHeight(height: number, bounds: HeightBounds): number {
  return Math.min(Math.max(height, bounds.min), bounds.max);
}

/** This device's storage, if the browser allows it. */
export function deviceStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** The height chosen on this device, or null for the default. */
export function readHeight(storage: Storage | undefined): number | null {
  try {
    const height = Number(storage?.getItem(heightKey) || NaN);
    return Number.isFinite(height) && height > 0 ? height : null;
  } catch {
    return null;
  }
}

/** Keeps a chosen height on this device, or forgets it for null. */
export function storeHeight(storage: Storage | undefined, height: number | null) {
  try {
    if (height === null) storage?.removeItem(heightKey);
    else storage?.setItem(heightKey, String(Math.round(height)));
  } catch {
    // Not kept, e.g. in a private window; the height still applies until reload.
  }
}
