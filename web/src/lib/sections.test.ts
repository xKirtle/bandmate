import { describe as group, expect, it } from 'vitest';
import type { Alternate, Section } from './api';
import { activeAlternate, alternateName, alternatesLabel, card, isEmpty, labelOf } from './sections';

function alternate(active: boolean, ...texts: string[]): Alternate {
  return {
    id: 1,
    name: '',
    active,
    lines: texts.map((text, i) => ({ id: i + 1, text, lyrics: text, chords: [], chordLine: false, cue: null })),
  };
}

function section(label: string, ...alternates: Alternate[]): Section {
  return { id: 1, label, alternates };
}

group('isEmpty', () => {
  it('is true for a Section with no Lines', () => {
    expect(isEmpty(section('', alternate(true)))).toBe(true);
  });

  it('is true when every Alternate has only blank Lines, whatever its Label', () => {
    expect(isEmpty(section('Chorus', alternate(true, '', '  '), alternate(false, '\t')))).toBe(true);
  });

  it('is false for a Chord Line', () => {
    expect(isEmpty(section('', alternate(true, '[G] [C]')))).toBe(false);
  });

  it('is false when only an inactive Alternate has Lines', () => {
    expect(isEmpty(section('', alternate(true), alternate(false, 'Drive')))).toBe(false);
  });
});

group('card', () => {
  it('shows every Line of the active Alternate when there are at most 4', () => {
    const c = card(section('Verse', alternate(false, 'Old'), alternate(true, 'A', 'B', 'C', 'D')));
    expect(c).toEqual({ lines: ['A', 'B', 'C', 'D'], more: 0, alternates: 2 });
  });

  it('shows the first 4 Lines and counts the rest', () => {
    const c = card(section('', alternate(true, 'A', 'B', 'C', 'D', 'E', 'F')));
    expect(c).toEqual({ lines: ['A', 'B', 'C', 'D'], more: 2, alternates: 1 });
  });

  it('shows Lines with their Chords, as written', () => {
    expect(card(section('', alternate(true, 'Hel[Am]lo'))).lines).toEqual(['Hel[Am]lo']);
  });
});

group('labelOf', () => {
  it('is the Label', () => {
    expect(labelOf(section('Chorus', alternate(true, 'La')))).toBe('Chorus');
  });

  it('says so when there is no Label, whatever the Lines', () => {
    expect(labelOf(section('', alternate(true, 'La')))).toBe('Section without a Label');
  });
});

group('activeAlternate', () => {
  it('is the active one, wherever it is', () => {
    const active = alternate(true, 'New');
    expect(activeAlternate(section('', alternate(false, 'Old'), active))).toBe(active);
  });
});

group('alternateName', () => {
  it('is its name', () => {
    const named = { ...alternate(false, 'La'), name: 'Darker' };
    expect(alternateName(section('', alternate(true), named), named)).toBe('Darker');
  });

  it('is its place among the Alternates when it has no name', () => {
    const second = alternate(false, 'La');
    expect(alternateName(section('', alternate(true), second), second)).toBe('Alternate 2');
  });
});

group('alternatesLabel', () => {
  it("adds the active Alternate's name and place among the Section's", () => {
    const darker = { ...alternate(true, 'La'), name: 'Darker' };
    expect(alternatesLabel(section('', darker, alternate(false), alternate(false)))).toBe('Alternates · Darker · 1 of 3');
  });

  it('calls an unnamed active Alternate by its place', () => {
    expect(alternatesLabel(section('', alternate(false), alternate(true)))).toBe('Alternates · Alternate 2 · 2 of 2');
  });

  it('is just "Alternates" for a Section with one Alternate', () => {
    expect(alternatesLabel(section('', alternate(true, 'La')))).toBe('Alternates');
  });
});
