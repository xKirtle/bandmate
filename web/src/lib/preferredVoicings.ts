// The user's preferred Voicing of each Chord, shown first in the Chord
// Finder's Look up. A choice about how the user plays, not about any Song:
// it's kept on this device, per Instrument and Chord, as the Instrument
// keeps one (on the guitar, its frets, and per tuning too, so a Voicing
// preferred in standard tuning doesn't pick a wrong one in Drop D). The
// Chord is the Chord itself, not how it was spelled: Dbmaj7 and C#maj7 sound
// the same and are played the same, so they share the one preference. None
// until preferred here.

import { oneSpellingOf, type Frets } from './chordFinder';
import { guitar } from './guitar';
import type { Instrument } from './instrument';

/**
 * Each Chord's preferred Voicing on one Instrument, as it keeps one, by the
 * Chord's name in the one spelling, so the two spellings of a Chord share
 * the one preference. On the guitar, the default, its frets in one tuning.
 */
export type PreferredVoicings<Kept = Frets> = Readonly<Record<string, Kept>>;

/** What an Instrument keeps its preferences by: where, and which kept values are its own. */
type Preferring<Kept> = Pick<Instrument<never, never, Kept>, 'preferredStorageKey' | 'isPreference'>;

/**
 * Whose preferences: an Instrument's, or a tuning's, for the guitar in it,
 * as preferences were named before the Chord Finder had Instruments.
 */
export type PreferredOn<Kept> = Preferring<Kept> | readonly number[];

function preferring<Kept>(on: PreferredOn<Kept>): Preferring<Kept> {
  // A tuning is the guitar's, which keeps its frets.
  return 'preferredStorageKey' in on ? on : (guitar(on) as unknown as Preferring<Kept>);
}

/** Where an Instrument's preferred Voicings are kept on this device: the guitar's per tuning, by its strings' pitches. */
export function preferredVoicingsKey(on: PreferredOn<unknown>): string {
  return preferring(on).preferredStorageKey;
}

/**
 * The preferred Voicings kept on this device for an Instrument, leaving out
 * any that have gone wrong. One kept under a Chord as it was spelled, before
 * a preference followed the Chord itself, is read under its one spelling, so
 * it still applies; where a device kept both spellings of a Chord, the last
 * of them wins.
 */
export function readPreferredVoicings<Kept = Frets>(
  storage: Storage | undefined,
  on: PreferredOn<Kept>,
): PreferredVoicings<Kept> {
  const instrument = preferring(on);
  try {
    const kept: unknown = JSON.parse(storage?.getItem(instrument.preferredStorageKey) ?? '{}');
    if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {};
    return Object.fromEntries(
      Object.entries(kept)
        .filter(([, preference]) => instrument.isPreference(preference))
        .map(([chord, preference]) => [spelledOneWay(chord), preference]),
    );
  } catch {
    return {};
  }
}

/**
 * Keeps a Chord's preferred Voicing on an Instrument on this device, as it
 * keeps one, or clears it with null. The Chord is named as the user wrote
 * it; it's kept, and cleared, by its name in the one spelling.
 */
export function storePreferredVoicing<Kept = Frets>(
  storage: Storage | undefined,
  on: PreferredOn<Kept>,
  chord: string,
  preference: Kept | null,
) {
  try {
    const preferred = withPreference(readPreferredVoicings(storage, on), chord, preference);
    const key = preferredVoicingsKey(on);
    if (Object.keys(preferred).length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(preferred));
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** Preferred Voicings with a Chord's preference set, or cleared with null, by the Chord's one spelling. */
export function withPreference<Kept>(
  preferred: PreferredVoicings<Kept>,
  chord: string,
  preference: Kept | null,
): PreferredVoicings<Kept> {
  const changed: Record<string, Kept> = { ...preferred };
  const kept = spelledOneWay(chord);
  if (preference !== null) changed[kept] = preference;
  else delete changed[kept];
  return changed;
}

/** The name a Chord's preference is kept by: its one spelling, or the name as written if it can't be read. */
function spelledOneWay(chord: string): string {
  return oneSpellingOf(chord) ?? chord;
}
