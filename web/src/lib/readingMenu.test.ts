import { describe, expect, it } from 'vitest';
import { blockedRows, readingBadge } from './readingMenu';

describe('readingBadge', () => {
  it('shows how far a Song with its Chords shown is transposed', () => {
    expect(readingBadge({ hasChords: true, chordsShown: true, transpose: 2 })).toBe('+2');
    expect(readingBadge({ hasChords: true, chordsShown: true, transpose: -3 })).toBe('−3');
  });

  it('shows nothing when the Chords show as written', () => {
    expect(readingBadge({ hasChords: true, chordsShown: true, transpose: 0 })).toBeNull();
  });

  it('shows nothing while the Chords are hidden, since nothing on screen is transposed', () => {
    expect(readingBadge({ hasChords: true, chordsShown: false, transpose: 2 })).toBeNull();
  });

  it('shows nothing for a Song without Chords', () => {
    expect(readingBadge({ hasChords: false, chordsShown: true, transpose: 2 })).toBeNull();
  });
});

describe('blockedRows', () => {
  it('blocks nothing while a Song shows its Chords', () => {
    expect(blockedRows({ hasChords: true, chordsShown: true })).toEqual({
      chords: null,
      transpose: null,
      chart: null,
    });
  });

  it('blocks Transpose and the Chord Chart, saying why, while the Chords are hidden', () => {
    expect(blockedRows({ hasChords: true, chordsShown: false })).toEqual({
      chords: null,
      transpose: 'Show the Chords to transpose them',
      chart: 'Show the Chords to see the Chord Chart',
    });
  });

  it('blocks every Chord row for a Song without Chords, whether or not they were hidden', () => {
    const blocked = {
      chords: 'This Song has no Chords',
      transpose: 'This Song has no Chords',
      chart: 'This Song has no Chords',
    };
    expect(blockedRows({ hasChords: false, chordsShown: true })).toEqual(blocked);
    expect(blockedRows({ hasChords: false, chordsShown: false })).toEqual(blocked);
  });
});
