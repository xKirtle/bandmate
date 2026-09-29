import { describe, expect, it } from 'vitest';
import { centredSquare, coverInitial, fitWithin } from './cover';

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
    expect(coverInitial('o\u0301mega')).toBe('Ó'); // decomposed
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

describe('fitWithin', () => {
  it('leaves a picture that fits as it is', () => {
    expect(fitWithin(1600, 1200, 2048)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it('scales a larger one down to fit its long side, keeping its shape', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it('never rounds a side down to nothing', () => {
    expect(fitWithin(10000, 1, 2048)).toEqual({ width: 2048, height: 1 });
  });
});

describe('centredSquare', () => {
  it('is the largest square, centred on the long side', () => {
    expect(centredSquare(1600, 1200)).toEqual({ x: 200, y: 0, size: 1200 });
    expect(centredSquare(1200, 1600)).toEqual({ x: 0, y: 200, size: 1200 });
  });

  it('is the whole of a square picture', () => {
    expect(centredSquare(800, 800)).toEqual({ x: 0, y: 0, size: 800 });
  });

  it('stays in whole pixels when the spare room is odd', () => {
    expect(centredSquare(1001, 600)).toEqual({ x: 200, y: 0, size: 600 });
  });
});
