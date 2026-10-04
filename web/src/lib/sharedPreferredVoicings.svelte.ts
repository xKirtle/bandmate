import { SvelteMap } from 'svelte/reactivity';
import { preferredVoicingsKey, readPreferredVoicings, storePreferredVoicing } from './preferredVoicings';
import type { Frets, PreferredVoicings } from './preferredVoicings';
import { deviceStorage } from './timelineHeight';

// The preferred Voicings on this device, per tuning, shared by every Chord
// Finder (and "How to play a Chord", once it exists), so preferring one moves
// it first wherever that Chord shows.

const changed = new SvelteMap<string, PreferredVoicings>();

export const preferredVoicings = {
  /** Each Chord's preferred Voicing in a tuning on this device. */
  of: (tuning: readonly number[]): PreferredVoicings =>
    changed.get(preferredVoicingsKey(tuning)) ?? readPreferredVoicings(deviceStorage(), tuning),
  /** Prefers a Voicing of a Chord in a tuning on this device, or clears the preference with null. */
  set(tuning: readonly number[], chord: string, frets: Frets | null) {
    const preferred: Record<string, Frets> = { ...preferredVoicings.of(tuning) };
    if (frets) preferred[chord] = frets;
    else delete preferred[chord];
    changed.set(preferredVoicingsKey(tuning), preferred);
    storePreferredVoicing(deviceStorage(), tuning, chord, frets);
  },
};
