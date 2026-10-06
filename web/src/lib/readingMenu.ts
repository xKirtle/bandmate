// The Reading menu, in Read mode's header: the Lyric Size, whether the Chords
// show, Transpose and the Chord Chart, gathered behind one button. Its rows
// stay in place for every Song, a Chord row disabled where it can't apply.

import { transposeText } from './transposeAmount';

/** What the Reading menu's rows depend on, for the Song open. */
export type ReadingChords = {
  /** Whether the Song has any Chords. */
  hasChords: boolean;
  /** Whether its Chords show on this device. */
  chordsShown: boolean;
};

/**
 * What the Reading button shows beside its icon: how far the Chords on
 * screen are transposed, e.g. "+2", or null when nothing shown is transposed.
 */
export function readingBadge({ hasChords, chordsShown, transpose }: ReadingChords & { transpose: number }) {
  return hasChords && chordsShown && transpose !== 0 ? transposeText(transpose) : null;
}

/** Why each Chord row of the Reading menu is disabled, or null where it isn't. */
export function blockedRows({ hasChords, chordsShown }: ReadingChords): {
  chords: string | null;
  transpose: string | null;
  chart: string | null;
} {
  if (!hasChords) {
    const none = 'This Song has no Chords';
    return { chords: none, transpose: none, chart: none };
  }
  if (!chordsShown) {
    return {
      chords: null,
      transpose: 'Show the Chords to transpose them',
      chart: 'Show the Chords to see the Chord Chart',
    };
  }
  return { chords: null, transpose: null, chart: null };
}
