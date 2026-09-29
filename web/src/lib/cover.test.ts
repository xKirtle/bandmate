import { describe, expect, it } from 'vitest';
import {
  centredSquare,
  clampSquare,
  coverInitial,
  fitWithin,
  maxCoverZoom,
  moveSquare,
  wholeSquare,
  zoomSquare,
} from './cover';

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

describe('clampSquare', () => {
  it('leaves a square that fits as it is', () => {
    expect(clampSquare({ x: 100, y: 50, size: 600 }, 1600, 1200)).toEqual({ x: 100, y: 50, size: 600 });
  });

  it('keeps the square inside the picture', () => {
    expect(clampSquare({ x: -40, y: 900, size: 600 }, 1600, 1200)).toEqual({ x: 0, y: 600, size: 600 });
    expect(clampSquare({ x: 1500, y: -1, size: 600 }, 1600, 1200)).toEqual({ x: 1000, y: 0, size: 600 });
  });

  it('never grows past the largest square, so there are never bars', () => {
    expect(clampSquare({ x: 0, y: 0, size: 5000 }, 1600, 1200)).toEqual({ x: 0, y: 0, size: 1200 });
  });

  it(`never shrinks past ${maxCoverZoom}× in`, () => {
    expect(clampSquare({ x: 0, y: 0, size: 10 }, 1600, 1200)).toEqual({ x: 0, y: 0, size: 1200 / maxCoverZoom });
  });

  it('is at least a pixel for a tiny picture', () => {
    expect(clampSquare({ x: 0, y: 0, size: 0.1 }, 3, 2)).toEqual({ x: 0, y: 0, size: 1 });
  });
});

describe('moveSquare', () => {
  it('moves by the given pixels', () => {
    expect(moveSquare({ x: 200, y: 0, size: 1200 }, -50, 0, 1600, 1200)).toEqual({ x: 150, y: 0, size: 1200 });
  });

  it('stops at the picture’s edges', () => {
    expect(moveSquare({ x: 200, y: 0, size: 1200 }, 900, 30, 1600, 1200)).toEqual({ x: 400, y: 0, size: 1200 });
  });
});

describe('zoomSquare', () => {
  it('keeps the point zoomed on where it was in the square', () => {
    // The point (500, 500) is a quarter of the way in, and stays so.
    expect(zoomSquare({ x: 400, y: 400, size: 400 }, 200, { x: 500, y: 500 }, 1600, 1200)).toEqual({
      x: 450,
      y: 450,
      size: 200,
    });
  });

  it('zooms out no further than the largest square', () => {
    expect(zoomSquare({ x: 400, y: 0, size: 600 }, 3000, { x: 700, y: 300 }, 1600, 1200)).toEqual({
      x: 100,
      y: 0,
      size: 1200,
    });
  });

  it('stays inside the picture as it zooms out by an edge', () => {
    expect(zoomSquare({ x: 0, y: 0, size: 300 }, 600, { x: 0, y: 0 }, 1600, 1200)).toEqual({ x: 0, y: 0, size: 600 });
    expect(zoomSquare({ x: 1300, y: 900, size: 300 }, 600, { x: 1600, y: 1200 }, 1600, 1200)).toEqual({
      x: 1000,
      y: 600,
      size: 600,
    });
  });
});

describe('wholeSquare', () => {
  it('rounds to whole pixels inside the picture', () => {
    expect(wholeSquare({ x: 10.4, y: 20.6, size: 300.5 }, 1600, 1200)).toEqual({ x: 10, y: 21, size: 301 });
  });

  it('keeps a square rounded up against an edge inside it', () => {
    expect(wholeSquare({ x: 1299.6, y: 0, size: 300.4 }, 1600, 1200)).toEqual({ x: 1300, y: 0, size: 300 });
    expect(wholeSquare({ x: 999.5, y: 0.2, size: 600.5 }, 1600, 1200)).toEqual({ x: 999, y: 0, size: 601 });
  });

  it('is the whole of a square picture zoomed all the way out', () => {
    expect(wholeSquare({ x: 0, y: 0, size: 800 }, 800, 800)).toEqual({ x: 0, y: 0, size: 800 });
  });
});
