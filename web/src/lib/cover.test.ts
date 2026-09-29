import { describe, expect, it } from 'vitest';
import { coverInitial } from './cover';

describe('coverInitial', () => {
  it("is the title's first letter, capitalised", () => {
    expect(coverInitial('Midnight Drive')).toBe('M');
    expect(coverInitial('slow burn')).toBe('S');
  });

  it('keeps a leading digit', () => {
    expect(coverInitial('99 Problems')).toBe('9');
  });

  it('skips leading spaces, punctuation and symbols', () => {
    expect(coverInitial('  (untitled)')).toBe('U');
    expect(coverInitial('“Home”')).toBe('H');
    expect(coverInitial('♪ lullaby')).toBe('L');
    expect(coverInitial('#1 Fan')).toBe('1');
  });

  it('handles non-Latin letters and accents', () => {
    expect(coverInitial('ómega')).toBe('Ó');
    expect(coverInitial('ómega')).toBe('Ó');
    expect(coverInitial('ωμέγα')).toBe('Ω');
    expect(coverInitial('夜に駆ける')).toBe('夜');
    expect(coverInitial('ßig')).toBe('ß');
  });

  it('falls back to the first character when there is no letter or digit', () => {
    expect(coverInitial('🎸🔥')).toBe('🎸');
    expect(coverInitial('...')).toBe('.');
  });

  it('is empty for a blank title', () => {
    expect(coverInitial('')).toBe('');
    expect(coverInitial('   ')).toBe('');
  });
});
