import { SvelteMap } from 'svelte/reactivity';
import { finderInstrument, type FinderContext, type Frets } from './chordFinder';
import { deviceStorage } from './deviceStorage';
import {
  preferredVoicingsKey,
  readPreferredVoicings,
  storePreferredVoicing,
  withPreference,
  type PreferredOn,
  type PreferredVoicings,
} from './preferredVoicings';

// The preferred Voicings on this device, per Instrument (and on the guitar
// per tuning), shared by every Chord Finder and the Chord Chart, so
// preferring one moves it first wherever that Chord shows.

const changed = new SvelteMap<string, PreferredVoicings<unknown>>();

export const preferredVoicings = {
  /** Each Chord's preferred Voicing on an Instrument, or the guitar in a tuning, on this device. */
  of: <Kept = Frets>(on: PreferredOn<Kept>): PreferredVoicings<Kept> =>
    (changed.get(preferredVoicingsKey(on)) as PreferredVoicings<Kept> | undefined) ??
    readPreferredVoicings(deviceStorage(), on),
  /** Prefers a Voicing of a Chord on an Instrument on this device, as it keeps one, or clears the preference with null. */
  set<Kept = Frets>(on: PreferredOn<Kept>, chord: string, preference: Kept | null) {
    changed.set(preferredVoicingsKey(on), withPreference(preferredVoicings.of(on), chord, preference));
    storePreferredVoicing(deviceStorage(), on, chord, preference);
  },
  /**
   * A Chord Finder's context with the user's preferred Voicings on its
   * Instrument: what Look up lists first, and what Suggest and the Chord
   * Chart draw. The two branches read alike, but each narrows the context
   * to one Instrument, so its preferences are that Instrument's kind.
   */
  preferring: (context: FinderContext): FinderContext =>
    context.instrument === 'piano'
      ? { ...context, preferred: preferredVoicings.of(finderInstrument(context)) }
      : { ...context, preferred: preferredVoicings.of(finderInstrument(context)) },
};
