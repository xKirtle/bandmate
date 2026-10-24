// How fast Auto-scroll goes: a level from 1 to 10. Like Transpose, it's a
// way of reading the Song, not an edit: it's kept on this device, for each
// Song, rather than saved with it.

/** The slowest speed level. */
export const slowestSpeed = 1;

/** The fastest speed level. */
export const fastestSpeed = 10;

/** The speed level of a Song never scrolled on this device. */
export const startingSpeed = 4;

/** Where a Song's Auto-scroll speed is kept on this device. */
export function autoScrollSpeedKey(songId: number): string {
  return `bandmate.autoScrollSpeed.${songId}`;
}

/** A Song's Auto-scroll speed on this device: 4 unless set here. */
export function readAutoScrollSpeed(storage: Storage | undefined, songId: number): number {
  try {
    const kept = storage?.getItem(autoScrollSpeedKey(songId));
    const level = kept ? Number(kept) : startingSpeed;
    return Number.isInteger(level) && level >= slowestSpeed && level <= fastestSpeed ? level : startingSpeed;
  } catch {
    return startingSpeed;
  }
}

/** Keeps a Song's Auto-scroll speed on this device, forgetting it once back to 4. */
export function storeAutoScrollSpeed(storage: Storage | undefined, songId: number, level: number) {
  try {
    if (level === startingSpeed) storage?.removeItem(autoScrollSpeedKey(songId));
    else storage?.setItem(autoScrollSpeedKey(songId), String(level));
  } catch {
    // Not kept, e.g. in a private window; the level still applies until reload.
  }
}

/** The level after stepping by `by` levels, held from 1 to 10. */
export function stepAutoScrollSpeed(level: number, by: number): number {
  return Math.max(slowestSpeed, Math.min(fastestSpeed, level + by));
}
