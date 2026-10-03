import { describe, expect, it } from 'vitest';
import { transposeChord } from './transpose';

describe('transposeChord', () => {
  it('moves the root by semitones', () => {
    expect(transposeChord('G', 2)).toBe('A');
    expect(transposeChord('C', -1)).toBe('B');
    expect(transposeChord('A', 11)).toBe('Ab');
  });

  it('reads a sharp or flat after the root, in ASCII or as a symbol', () => {
    expect(transposeChord('F#', 1)).toBe('G');
    expect(transposeChord('Bb', 1)).toBe('B');
    expect(transposeChord('F♯', -1)).toBe('F');
    expect(transposeChord('E♭', 2)).toBe('F');
  });

  it('keeps the rest of the name as written', () => {
    expect(transposeChord('Am7', 2)).toBe('Bm7');
    expect(transposeChord('Dsus4', -2)).toBe('Csus4');
    expect(transposeChord('Cadd9(#11)', 5)).toBe('Fadd9(#11)');
    expect(transposeChord('C6/9', 2)).toBe('D6/9');
  });

  it("moves a slash chord's bass note too", () => {
    expect(transposeChord('F#m7/C#', 2)).toBe('Abm7/Eb');
    expect(transposeChord('C/E', -1)).toBe('B/Eb');
    expect(transposeChord('G/B♭', 2)).toBe('A/C');
  });

  it("leaves a name that doesn't start with a readable note as written", () => {
    for (const name of ['N.C.', 'riff', 'x2', 'am', 'H7', 'Sol', '', '/E']) {
      expect(transposeChord(name, 3)).toBe(name);
    }
  });

  it('reads a solfège name that starts with a capital C–G as a note, by the rule', () => {
    expect(transposeChord('Do', 2)).toBe('Eo');
    expect(transposeChord('Fa', 2)).toBe('Ga');
  });

  it('leaves the whole name as written when moved by 0', () => {
    expect(transposeChord('A♯m/D♭', 0)).toBe('A♯m/D♭');
  });

  it('spells moved notes C# Eb F# Ab Bb', () => {
    expect(['C', 'D', 'F', 'G', 'A'].map((n) => transposeChord(n, 1))).toEqual(['C#', 'Eb', 'F#', 'Ab', 'Bb']);
  });
});
