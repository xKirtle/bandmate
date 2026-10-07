import { describe, expect, it } from 'vitest';
import { diagramStartFret } from './guitar';

describe("a chord diagram's first row", () => {
  it('starts a barre at its fret, so the barre is the first row', () => {
    // G barred on the 3rd fret, though it fits under the nut.
    expect(diagramStartFret({ frets: [3, 5, 5, 4, 3, 3], barre: { fret: 3, from: 0, to: 5 } }, 5)).toBe(3);
    // B barred on the 2nd.
    expect(diagramStartFret({ frets: [null, 2, 4, 4, 4, 2], barre: { fret: 2, from: 1, to: 5 } }, 5)).toBe(2);
  });

  it('keeps a barre on the 1st fret under the nut', () => {
    expect(diagramStartFret({ frets: [1, 3, 3, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } }, 5)).toBe(1);
  });

  it('starts a Voicing with no barre under the nut when it fits there', () => {
    expect(diagramStartFret({ frets: [null, 3, 2, 0, 1, 0] }, 5)).toBe(1);
    expect(diagramStartFret({ frets: [null, null, 5, 4, 3, 3] }, 5)).toBe(1);
    expect(diagramStartFret({ frets: [0, 0, 0, 0, 0, 0] }, 5)).toBe(1);
  });

  it('starts a Voicing with no barre up the neck at its lowest fret', () => {
    expect(diagramStartFret({ frets: [null, 7, 9, 9, 8, null] }, 5)).toBe(7);
  });
});
