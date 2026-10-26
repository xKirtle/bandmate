import type { SampleSet } from './samples';
import type { Toast } from './Toasts.svelte';

// The Instrument a Hear or Arpeggiate couldn't be heard on, its samples not
// loading, which a toast says until it's dismissed or they load (ADR 0030):
// shared by the Chord Finder's page and the Song page, where a Chord's
// popover hears.

// Raw, not a deep proxy, so it's the very set hearing names, to compare.
let shown = $state.raw<SampleSet | null>(null);

export const unheard = {
  /** The samples that couldn't load for a press, if any. */
  get set(): SampleSet | null {
    return shown;
  },
  /** A press couldn't be heard: its Instrument's samples didn't load. */
  show(set: SampleSet) {
    shown = set;
  },
  /** An Instrument's samples loaded, so its toast, if any, goes. */
  heard(set: SampleSet) {
    if (shown === set) shown = null;
  },
  /** The toast is dismissed. */
  dismiss() {
    shown = null;
  },
};

/** The toast saying so, if a press couldn't be heard: labelled with the Instrument, for the toast stack. */
export function unheardToasts(): Toast[] {
  const set = shown;
  if (!set) return [];
  return [{ label: set.name, message: "Couldn't be heard, as it didn't load. Try again.", dismiss: unheard.dismiss }];
}
