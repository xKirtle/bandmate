// How far Read mode transposes a Song's Chords, in semitones. Like hiding the
// Chords, it's a way of reading the Song, not an edit: it's kept on this
// device, for each Song, rather than saved with it. 0 shows them as written.

/** The furthest the Chords can be transposed, up or down. */
export const transposeLimit = 11;

/** Where a Song's Transpose amount is kept on this device. */
export function transposeKey(songId: number): string {
  return `bandmate.transpose.${songId}`;
}

/** How far a Song's Chords are transposed on this device: 0 unless transposed here. */
export function readTranspose(storage: Storage | undefined, songId: number): number {
  try {
    const kept = storage?.getItem(transposeKey(songId));
    const amount = kept ? Number(kept) : 0;
    return Number.isInteger(amount) && Math.abs(amount) <= transposeLimit ? amount : 0;
  } catch {
    return 0;
  }
}

/** Keeps how far a Song's Chords are transposed on this device, forgetting it once back to 0. */
export function storeTranspose(storage: Storage | undefined, songId: number, amount: number) {
  try {
    if (amount === 0) storage?.removeItem(transposeKey(songId));
    else storage?.setItem(transposeKey(songId), String(amount));
  } catch {
    // Not kept, e.g. in a private window; the amount still applies until reload.
  }
}
