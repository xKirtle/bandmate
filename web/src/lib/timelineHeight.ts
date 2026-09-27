// How tall the Timeline's Tracks area is: dragged by its top edge, kept on
// this device for every Song, and never taller than the window allows or the
// Tracks need.

/** Where the chosen height is kept on this device. */
export const heightKey = 'bandmate.timelineHeight';

/** The least and most the Tracks area can be, in pixels. */
export interface HeightBounds {
  min: number;
  max: number;
}

/** How tall the Tracks area is until one's chosen: 40% of the window. */
export function defaultHeight(windowHeight: number): number {
  return windowHeight * 0.4;
}

/**
 * From least, one Track and the ruler, to 85% of the window, leaving room for
 * the page header, but no taller than the Tracks need once that's known (not 0).
 */
export function heightBounds(windowHeight: number, least: number, needed: number): HeightBounds {
  const most = needed > 0 ? Math.min(windowHeight * 0.85, needed) : windowHeight * 0.85;
  return { min: least, max: Math.max(least, most) };
}

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
