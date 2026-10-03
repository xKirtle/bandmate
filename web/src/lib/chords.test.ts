import { describe, expect, it } from 'vitest';
import type { Line } from './api';
import { layoutLine } from './chords';

function line(lyrics: string, chords: Line['chords']): Line {
  return { id: 1, text: '', lyrics, chords, chordLine: false, cue: null } as Line;
}

describe('layoutLine', () => {
  it('shows each Chord transposed by the amount, above its lyrics', () => {
    const shown = layoutLine(
      line('Hello you', [
        { offset: 3, name: 'Am' },
        { offset: 6, name: 'N.C.' },
        { offset: 6, name: 'C/G' },
      ]),
      2,
    );
    expect(shown).toEqual([
      [
        { chord: '', text: 'Hel' },
        { chord: 'Bm', text: 'lo ' },
      ],
      [{ chord: 'N.C. D/A', text: 'you' }],
    ]);
  });

  it('shows the Chords as written by default', () => {
    expect(layoutLine(line('Hi', [{ offset: 0, name: 'F#' }]))).toEqual([[{ chord: 'F#', text: 'Hi' }]]);
  });
});
