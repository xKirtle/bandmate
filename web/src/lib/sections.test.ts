import { describe as group, expect, it } from 'vitest';
import type { Alternate, Section } from './api';
import { isEmpty } from './sections';

function alternate(active: boolean, ...texts: string[]): Alternate {
  return {
    id: 1,
    name: '',
    active,
    lines: texts.map((text, i) => ({ id: i + 1, text, lyrics: text, chords: [], chordLine: false })),
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
