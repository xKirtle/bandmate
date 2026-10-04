// The user's preferred Voicing of each Chord, shown first in the Chord
// Finder's Look up. A choice about how the user plays, not about any Song:
// it's kept on this device, per Instrument, tuning and Chord, so a Voicing
// preferred in standard tuning doesn't pick a wrong one in Drop D. Only the
// guitar for now. None until preferred here.

import type { Frets } from './chordFinder';

/** Each Chord's preferred Voicing in one tuning, by the Chord's name as read. */
export type PreferredVoicings = Readonly<Record<string, Frets>>;

/**
 * Where a tuning's preferred guitar Voicings are kept on this device. The
 * tuning is kept by its strings' pitches, so "Drop D" and "D A D G B E" share.
 */
export function preferredVoicingsKey(tuning: readonly number[]): string {
  return `bandmate.preferredVoicings.guitar.${tuning.join('-')}`;
}

/** The preferred Voicings kept on this device for a tuning, leaving out any that have gone wrong. */
export function readPreferredVoicings(storage: Storage | undefined, tuning: readonly number[]): PreferredVoicings {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(preferredVoicingsKey(tuning)) ?? '{}');
    if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {};
    return Object.fromEntries(Object.entries(kept).filter(([, frets]) => fitsTuning(frets, tuning)));
  } catch {
    return {};
  }
}

/** Keeps a Chord's preferred Voicing in a tuning on this device, or clears it with null. */
export function storePreferredVoicing(
  storage: Storage | undefined,
  tuning: readonly number[],
  chord: string,
  frets: Frets | null,
) {
  try {
    const preferred = withPreference(readPreferredVoicings(storage, tuning), chord, frets);
    const key = preferredVoicingsKey(tuning);
    if (Object.keys(preferred).length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(preferred));
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** Preferred Voicings with a Chord's preference set to a Voicing's frets, or cleared with null. */
export function withPreference(preferred: PreferredVoicings, chord: string, frets: Frets | null): PreferredVoicings {
  const changed: Record<string, Frets> = { ...preferred };
  if (frets) changed[chord] = frets;
  else delete changed[chord];
  return changed;
}

/** Whether a kept value is a fret, or muted, for each of the tuning's strings. */
function fitsTuning(frets: unknown, tuning: readonly number[]): frets is Frets {
  return (
    Array.isArray(frets) &&
    frets.length === tuning.length &&
    frets.every((f) => f === null || (Number.isInteger(f) && f >= 0))
  );
}
