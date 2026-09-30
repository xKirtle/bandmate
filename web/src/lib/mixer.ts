// How loud each Track plays, from its volume, mute and solo. Plain
// arithmetic, so playback only has to apply it.

/** A Track's levels: its volume in dB, and whether it's muted or soloed. */
export interface Levels {
  id: number;
  volume: number;
  muted: boolean;
  soloed: boolean;
}

/** A Track's lowest volume, in dB. It's still heard there: muting it is what silences it. */
export const minVolume = -36;
/** A Track's highest volume, in dB. Clipping up there is left to the user. */
export const maxVolume = 36;

/**
 * Each Track's gain by id, as a factor of its audio. When some Tracks are
 * soloed, only those play; a muted Track never does, even soloed.
 */
export function trackGains(tracks: readonly Levels[]): Map<number, number> {
  const soloing = tracks.some((t) => t.soloed);
  return new Map(
    tracks.map((t) => {
      const heard = !t.muted && (!soloing || t.soloed);
      return [t.id, heard ? 10 ** (t.volume / 20) : 0];
    }),
  );
}

/** A volume as shown next to its fader. */
export function formatVolume(volume: number): string {
  if (volume === 0) return '0 dB';
  return `${volume > 0 ? '+' : '−'}${Math.abs(volume)} dB`;
}
