// The Reading menu, in Read mode's header: the Lyric Size, whether the Chords
// show, Transpose and the Chord Chart, gathered behind one button. Its rows
// stay in place for every Song, a Chord row disabled where it can't apply.

import type { ChordsInRead } from './chordChart';
import { transposeText } from './transposeAmount';

/** What the Reading menu's rows depend on, for the Song open. */
export type ReadingChords = {
  /** Where the Song has Chords, as Read mode shows it. */
  chords: ChordsInRead;
  /** Whether its Chords show on this device. */
  chordsShown: boolean;
};

/**
 * What the Reading button shows beside its icon: how far the Chords on
 * screen are transposed, e.g. "+2", or null when nothing shown is transposed.
 */
export function readingBadge({ chords, chordsShown, transpose }: ReadingChords & { transpose: number }) {
  return chords === 'shown' && chordsShown && transpose !== 0 ? transposeText(transpose) : null;
}

/** Why each Chord row of the Reading menu is disabled, or null where it isn't. */
export function blockedRows({ chords, chordsShown }: ReadingChords): {
  chords: string | null;
  transpose: string | null;
  chart: string | null;
} {
  if (chords !== 'shown') {
    const why = chords === 'none' ? 'This Song has no Chords' : "No Chords in the Arrangement's active Alternates";
    return { chords: why, transpose: why, chart: why };
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
