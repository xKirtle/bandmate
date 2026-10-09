import { describe, expect, it } from 'vitest';
import { formatPitch, pitchOf, stretchBadge } from './clipPitch';

describe('a Pitch', () => {
  it('is shown in semitones, signed', () => {
    expect(formatPitch(-2)).toBe('−2 st');
    expect(formatPitch(3)).toBe('+3 st');
    expect(formatPitch(0)).toBe('0 st');
  });

  it('is set in whole semitones, from −12 to +12', () => {
    expect(pitchOf(-2)).toBe(-2);
    expect(pitchOf(2.4)).toBe(2);
    expect(pitchOf(-20)).toBe(-12);
    expect(pitchOf(15)).toBe(12);
    expect(Object.is(pitchOf(-0.2), 0)).toBe(true);
  });
});

describe('the badge of a Clip’s Tempo and Pitch', () => {
  it('shows both when both are changed', () => {
    expect(stretchBadge({ tempo: 0.92, pitch: -2 })).toBe('92% · −2 st');
  });

  it('shows only the one changed', () => {
    expect(stretchBadge({ tempo: 1, pitch: 3 })).toBe('+3 st');
    expect(stretchBadge({ tempo: 1.1, pitch: 0 })).toBe('110%');
  });

  it('is left out while neither is', () => {
    expect(stretchBadge({ tempo: 1, pitch: 0 })).toBeNull();
  });
});
