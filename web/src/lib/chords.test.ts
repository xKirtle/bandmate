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
        { chords: [], text: 'Hel' },
        { chords: ['Bm'], text: 'lo ' },
      ],
      [{ chords: ['N.C.', 'D/A'], text: 'you' }],
    ]);
  });

  it("spells the moved Chords from the Song's key", () => {
    expect(layoutLine(line('Hi', [{ offset: 0, name: 'F#m7/C#' }]), 2, 'G')).toEqual([
      [{ chords: ['G#m7/D#'], text: 'Hi' }],
    ]);
  });

  it('shows the Chords as written by default', () => {
    expect(layoutLine(line('Hi', [{ offset: 0, name: 'F#' }]))).toEqual([[{ chords: ['F#'], text: 'Hi' }]]);
  });

  it('puts a between-words Chord over all the whitespace it falls in, needing no room past its name', () => {
    expect(layoutLine(line('I  wake', [{ offset: 2, name: 'G' }]))).toEqual([
      [{ chords: [], text: 'I' }],
      [{ chords: ['G'], text: '  ', snug: true }],
      [{ chords: [], text: 'wake' }],
    ]);
  });

  it('keeps the usual room after a between-words Chord when a Chord comes straight after', () => {
    expect(
      layoutLine(
        line('I  wake', [
          { offset: 2, name: 'G' },
          { offset: 3, name: 'C' },
        ]),
      ),
    ).toEqual([[{ chords: [], text: 'I' }], [{ chords: ['G'], text: '  ' }], [{ chords: ['C'], text: 'wake' }]]);
  });

  it('splits whitespace holding two between-words Chords where the second falls', () => {
    expect(
      layoutLine(
        line('I   wake', [
          { offset: 2, name: 'G' },
          { offset: 3, name: 'C' },
        ]),
      ),
    ).toEqual([
      [{ chords: [], text: 'I' }],
      [{ chords: ['G'], text: '  ' }],
      [{ chords: ['C'], text: ' ', snug: true }],
      [{ chords: [], text: 'wake' }],
    ]);
  });

  it('treats a Chord on a space at the start of a Line as between words', () => {
    expect(layoutLine(line(' Another day', [{ offset: 0, name: 'G' }]))).toEqual([
      [{ chords: ['G'], text: ' ', snug: true }],
      [{ chords: [], text: 'Another ' }],
      [{ chords: [], text: 'day' }],
    ]);
  });

  it("leaves a Chord Line's Chords as they are", () => {
    const chordLine = { ...line('  ', [{ offset: 1, name: 'Am' }]), chordLine: true };
    expect(layoutLine(chordLine)).toEqual([[{ chords: [], text: ' ' }], [{ chords: ['Am'], text: ' ' }]]);
  });
});
