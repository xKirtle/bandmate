import { describe, expect, it } from 'vitest';
import { commonKeys } from './api';
import { keys as finderKeys } from './chordFinder';
import { keys, plainSignature, readKey, signature, transposeChord, transposeKey } from './transpose';

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

  it('leaves a solfège name starting Do or Fa as written', () => {
    for (const name of ['Do', 'Do7', 'Dom7', 'Dob', 'Fa', 'Fa#m', 'Fa♭', 'Fa/Do', 'Fa(add9)']) {
      expect(transposeChord(name, 2)).toBe(name);
    }
  });

  it('still moves a letter name whose second letter makes it English', () => {
    expect(transposeChord('Fadd9', 2)).toBe('Gadd9');
    expect(transposeChord('Faug', 2)).toBe('Gaug');
    expect(transposeChord('D°7', 2)).toBe('E°7');
    expect(transposeChord('Dm7', 2)).toBe('Em7');
    expect(transposeChord('C/Do', 2)).toBe('D/Do');
  });

  it('leaves the whole name as written when moved by 0', () => {
    expect(transposeChord('A♯m/D♭', 0)).toBe('A♯m/D♭');
  });

  it('spells moved notes C# Eb F# Ab Bb', () => {
    expect(['C', 'D', 'F', 'G', 'A'].map((n) => transposeChord(n, 1))).toEqual(['C#', 'Eb', 'F#', 'Ab', 'Bb']);
  });
});

describe("transposeChord with the Song's key", () => {
  it("spells moved notes from the shown key's signature", () => {
    // G up 3 is Bb major, with flats; G up 2 is A major, with sharps.
    expect(transposeChord('A#m', 3, 'G')).toBe('Dbm');
    expect(transposeChord('F#m7/C#', 2, 'G')).toBe('G#m7/D#');
    expect(transposeChord('C/G', 1, 'C')).toBe('Db/Ab');
    expect(transposeChord('C', 1, 'D#')).toBe('C#');
    expect(transposeChord('D', -1, 'F#')).toBe('Db');
  });

  it('spells by letter where the key reaches E#, as the Chord Finder does', () => {
    // F up 1 is F# major, F# G# A# B C# D# E#, which has already spent F on F#.
    expect(transposeChord('E', 1, 'F')).toBe('E#');
    expect(transposeChord('Em7/G', 1, 'F')).toBe('E#m7/G#');
    // Dm up 1 is D# minor, whose relative major is F#.
    expect(transposeChord('E', 1, 'Dm')).toBe('E#');
  });

  it('reads F major as flats and E major as sharps', () => {
    expect(transposeChord('A', 1, 'E')).toBe('Bb');
    expect(transposeChord('A', 1, 'Eb')).toBe('A#');
  });

  it("follows a minor key's signature", () => {
    // Gm up 7 is D minor, with a flat; Gm up 4 is B minor, with sharps.
    expect(transposeChord('B', 7, 'Gm')).toBe('Gb');
    expect(transposeChord('E', 4, 'Gm')).toBe('G#');
    expect(transposeChord('Ab', 5, 'G minor')).toBe('Db');
    expect(transposeChord('E', 2, 'C Minor')).toBe('Gb');
    expect(transposeChord('D', 1, 'Dmin')).toBe('D#');
    expect(transposeChord('E', -1, 'C min')).toBe('D#');
  });

  it('reads a capital M, maj or major after the note as major', () => {
    for (const key of ['DM', 'D maj', 'D major']) expect(transposeChord('C', 1, key)).toBe('Db');
  });

  it('keeps the common spellings in C major, A minor, or an unreadable key', () => {
    const naturals = ['C', 'D', 'F', 'G', 'A'];
    const keys = [
      ['Bb', 2],
      ['Gm', 2],
      ['', 1],
      ['Do', 1],
      ['Fa#', 1],
      ['h', 1],
      ['riff', 1],
    ] as const;
    for (const [key, by] of keys) {
      expect(naturals.map((n) => transposeChord(n, by, key))).toEqual(naturals.map((n) => transposeChord(n, by)));
    }
  });
});

describe('a signature spelled by letter', () => {
  it('is the plain one but where the key has spent the letter: only F# major, whose F is E#', () => {
    const changed = Array.from({ length: 12 }, (_, tonic) => {
      const plain = plainSignature(tonic, false);
      return signature(tonic, false).flatMap((spelling, semitone) =>
        spelling === plain[semitone] ? [] : [`${plain[tonic]} major: ${plain[semitone]} is ${spelling}`],
      );
    }).flat();
    expect(changed).toEqual(['F# major: F is E#']);
  });

  it('never needs a double accidental for a key offered', () => {
    for (const key of keys) {
      const read = readKey(key)!;
      for (const spelling of read.signature) expect(spelling).toMatch(/^[A-G][#b]?$/);
    }
  });
});

describe('transposeKey', () => {
  it('moves a readable key by semitones', () => {
    expect(transposeKey('G', 2)).toBe('A');
    expect(transposeKey('A', -2)).toBe('G');
    expect(transposeKey('B♭', 2)).toBe('C');
  });

  it('keeps the rest of the key as written', () => {
    expect(transposeKey('G minor', 2)).toBe('A minor');
    expect(transposeKey('C#m', 1)).toBe('Dm');
    expect(transposeKey('E major', -1)).toBe('Eb major');
  });

  it("spells the shown key's note from its signature", () => {
    expect(transposeKey('G', 1)).toBe('Ab');
    expect(transposeKey('G', 6)).toBe('Db');
    expect(transposeKey('C', 6)).toBe('F#');
    expect(transposeKey('Gm', 1)).toBe('G#m');
    expect(transposeKey('Gm', 6)).toBe('C#m');
    expect(transposeKey('Am', 1)).toBe('Bbm');
    expect(transposeKey('Dm', 1)).toBe('D#m');
  });

  it("is null when the key can't be read, or isn't moved", () => {
    for (const key of ['', 'riff', 'am', 'H', 'Do', 'Fa#m', 'Sol']) expect(transposeKey(key, 2)).toBeNull();
    expect(transposeKey('G', 0)).toBeNull();
  });
});

describe('the keys offered', () => {
  it('are all 24, each read as Transpose reads a key, once', () => {
    const read = keys.map((k) => readKey(k));
    expect(read.every((k) => k !== null)).toBe(true);
    expect(new Set(read.map((k) => `${k!.tonic} ${k!.minor}`)).size).toBe(24);
  });

  it('are interleaved by tonic, each spelled from its own signature', () => {
    expect(keys).toEqual([
      'C',
      'Cm',
      'Db',
      'C#m',
      'D',
      'Dm',
      'Eb',
      'D#m',
      'E',
      'Em',
      'F',
      'Fm',
      'F#',
      'F#m',
      'G',
      'Gm',
      'Ab',
      'G#m',
      'A',
      'Am',
      'Bb',
      'Bbm',
      'B',
      'Bm',
    ]);
  });

  it('offer no Key no signature can spell: not D#, G# or A# major', () => {
    expect(keys).not.toContain('D#');
    expect(keys).not.toContain('G#');
    expect(keys).not.toContain('A#');
  });

  it('are the one list the Song and Beat Key field and the Finder both offer', () => {
    expect(commonKeys).toBe(keys);
    expect(finderKeys).toBe(keys);
  });
});
