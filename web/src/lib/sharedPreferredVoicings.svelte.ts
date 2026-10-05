import { SvelteMap } from 'svelte/reactivity';
import type { Frets } from './chordFinder';
import {
  preferredVoicingsKey,
  readPreferredVoicings,
  storePreferredVoicing,
  withPreference,
  type PreferredVoicings,
} from './preferredVoicings';
import { deviceStorage } from './timelineHeight';

// The preferred Voicings on this device, per tuning, shared by every Chord
// Finder and the Chord Chart, so preferring one moves it first wherever that
// Chord shows.

const changed = new SvelteMap<string, PreferredVoicings>();

export const preferredVoicings = {
  /** Each Chord's preferred Voicing in a tuning on this device. */
  of: (tuning: readonly number[]): PreferredVoicings =>
    changed.get(preferredVoicingsKey(tuning)) ?? readPreferredVoicings(deviceStorage(), tuning),
  /** Prefers a Voicing of a Chord in a tuning on this device, or clears the preference with null. */
  set(tuning: readonly number[], chord: string, frets: Frets | null) {
    changed.set(preferredVoicingsKey(tuning), withPreference(preferredVoicings.of(tuning), chord, frets));
    storePreferredVoicing(deviceStorage(), tuning, chord, frets);
  },
};
