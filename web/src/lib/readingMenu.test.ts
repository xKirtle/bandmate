import { describe, expect, it } from 'vitest';
import { blockedRows, readingBadge } from './readingMenu';

describe('readingBadge', () => {
  it('shows how far a Song with its Chords shown is transposed', () => {
    expect(readingBadge({ chords: 'shown', chordsShown: true, transpose: 2 })).toBe('+2');
    expect(readingBadge({ chords: 'shown', chordsShown: true, transpose: -3 })).toBe('−3');
  });

  it('shows nothing when the Chords show as written', () => {
    expect(readingBadge({ chords: 'shown', chordsShown: true, transpose: 0 })).toBeNull();
  });

  it('shows nothing while the Chords are hidden, since nothing on screen is transposed', () => {
    expect(readingBadge({ chords: 'shown', chordsShown: false, transpose: 2 })).toBeNull();
  });

  it('shows nothing when Read mode shows none of the Chords', () => {
    expect(readingBadge({ chords: 'elsewhere', chordsShown: true, transpose: 2 })).toBeNull();
  });

  it('shows nothing for a Song without Chords', () => {
    expect(readingBadge({ chords: 'none', chordsShown: true, transpose: 2 })).toBeNull();
  });
});

describe('blockedRows', () => {
  it('blocks nothing while a Song shows its Chords and the Chord Chart', () => {
    expect(blockedRows({ chords: 'shown', chordsShown: true, chartShown: true })).toEqual({
      chords: null,
      transpose: null,
      chart: null,
      chartSize: null,
    });
  });

  it('blocks Transpose and the Chord Chart, saying why, while the Chords are hidden', () => {
    const blocked = {
      chords: null,
      transpose: 'Show the Chords to transpose them',
      chart: 'Show the Chords to see the Chord Chart',
      chartSize: 'Show the Chords to see the Chord Chart',
    };
    expect(blockedRows({ chords: 'shown', chordsShown: false, chartShown: true })).toEqual(blocked);
    expect(blockedRows({ chords: 'shown', chordsShown: false, chartShown: false })).toEqual(blocked);
  });

  it('blocks only the Chart Size, saying why, while the Chord Chart is hidden', () => {
    expect(blockedRows({ chords: 'shown', chordsShown: true, chartShown: false })).toEqual({
      chords: null,
      transpose: null,
      chart: null,
      chartSize: 'Show the Chord Chart to size it',
    });
  });

  it("blocks every Chord row, saying why, when only what Read mode doesn't show has Chords", () => {
    const why = "No Chords in the Arrangement's active Alternates";
    const blocked = { chords: why, transpose: why, chart: why, chartSize: why };
    expect(blockedRows({ chords: 'elsewhere', chordsShown: true, chartShown: true })).toEqual(blocked);
    expect(blockedRows({ chords: 'elsewhere', chordsShown: false, chartShown: false })).toEqual(blocked);
  });

  it('blocks every Chord row for a Song without Chords, whether or not they were hidden', () => {
    const why = 'This Song has no Chords';
    const blocked = { chords: why, transpose: why, chart: why, chartSize: why };
    expect(blockedRows({ chords: 'none', chordsShown: true, chartShown: true })).toEqual(blocked);
    expect(blockedRows({ chords: 'none', chordsShown: false, chartShown: false })).toEqual(blocked);
  });
});
