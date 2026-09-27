// The volume of the players outside the Timeline (Masters and Beat previews):
// one level and mute for all of them, kept on this device. Track volumes on
// the Timeline are separate.

/** Where the volume is kept on this device. */
export const volumeKey = 'bandmate.playerVolume';

/** A slider position from 0 to 1, and whether it's muted. */
export interface Volume {
  level: number;
  muted: boolean;
}

export const defaultVolume: Volume = { level: 1, muted: false };

/** What unmuting restores when the slider was dragged all the way down. */
export const unmutedLevel = 0.5;

/** The slider moved to level; all the way down counts as muted, anywhere else unmutes. */
export function setLevel(level: number): Volume {
  const clamped = Math.min(1, Math.max(0, level));
  return { level: clamped, muted: clamped === 0 };
}

/** Mutes, or unmutes back to the level before, or to unmutedLevel from silence. */
export function toggleMute(v: Volume): Volume {
  if (!v.muted) return { ...v, muted: true };
  return { level: v.level > 0 ? v.level : unmutedLevel, muted: false };
}

/** The element's volume for a slider position: squared, so loudness changes evenly along it. */
export function gain(level: number): number {
  return level * level;
}

/** Which speaker icon shows. */
export function loudness(v: Volume): 'muted' | 'low' | 'high' {
  if (v.muted || v.level === 0) return 'muted';
  return v.level < 0.5 ? 'low' : 'high';
}

/** The volume kept on this device, or the default. */
export function readVolume(storage: Storage | undefined): Volume {
  try {
    const kept = JSON.parse(storage?.getItem(volumeKey) ?? 'null');
    const level = kept?.level;
    if (typeof level !== 'number' || !(level >= 0 && level <= 1)) return defaultVolume;
    return { level, muted: kept.muted === true };
  } catch {
    return defaultVolume;
  }
}

/** Keeps the volume on this device. */
export function storeVolume(storage: Storage | undefined, v: Volume) {
  try {
    storage?.setItem(volumeKey, JSON.stringify(v));
  } catch {
    // Not kept, e.g. in a private window; the volume still applies until reload.
  }
}
