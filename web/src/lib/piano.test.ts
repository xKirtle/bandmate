import { describe, expect, it } from 'vitest';
import {
  firstVoicing,
  lookUp,
  nameIt,
  pianoKeyName,
  qualities,
  roots,
  strummed,
  voicingPlucks,
  type PianoVoicing,
} from './chordFinder';

// The piano in the Chord Finder (ADR 0012), through its seam: one hand's
// Voicings, each inversion in close position, round middle C, drawn on a
// keyboard from C3 to C5. Keys are MIDI note numbers: 60 is middle C (C4).

const piano = { instrument: 'piano' as const };

/** A Chord's piano Voicings, or none if it can't be read. */
function voicings(name: string): PianoVoicing[] {
  const found = lookUp(name, piano);
  return found.kind === 'chord' ? found.voicings : [];
}

describe("Look up's piano Voicings", () => {
  it('are root position and each inversion, in close position, round middle C', () => {
    expect(voicings('C').map((v) => [v.inversion, v.keys])).toEqual([
      [0, [60, 64, 67]],
      [1, [64, 67, 72]],
      [2, [55, 60, 64]],
    ]);
  });

  it("are one hand's: without a slash bass, no key is in the left hand", () => {
    expect(voicings('Am').every((v) => v.left.length === 0)).toBe(true);
  });

  it('keep every tone of a Chord of four notes, the fifth too', () => {
    expect(voicings('C7')[0].keys).toEqual([60, 64, 67, 70]);
    expect(voicings('C7')).toHaveLength(4);
  });

  it('leave out the optional tones of a Chord of more than four notes', () => {
    // C9 is C E (G) Bb D: the fifth goes, and the ninth sits next to the root.
    expect(voicings('C9')[0].keys).toEqual([60, 62, 64, 70]);
    expect(voicings('C9')).toHaveLength(4);
    // C13 is C E (G) Bb (D) A: both optional tones go.
    expect(voicings('C13')[0].keys).toEqual([60, 64, 69, 70]);
  });

  it('move down an octave where round middle C would run past C5', () => {
    // F#maj7 from F#4 would reach F5.
    expect(voicings('F#maj7')[0].keys).toEqual([54, 58, 61, 65]);
  });

  it("list a slash Chord's inversion with its bass lowest first, then the rest with the bass under them in the left hand", () => {
    expect(voicings('C/G').map((v) => [v.inversion, v.keys, v.left])).toEqual([
      [2, [55, 60, 64], []],
      [0, [55, 60, 64, 67], [55]],
      [1, [55, 64, 67, 72], [55]],
    ]);
  });

  it('put a bass that is none of the Chord’s tones under every inversion', () => {
    expect(voicings('Am/G').map((v) => [v.inversion, v.keys, v.left])).toEqual([
      [0, [55, 57, 60, 64], [55]],
      [1, [55, 60, 64, 69], [55]],
      [2, [55, 64, 69, 72], [55]],
    ]);
  });

  it('all fit the piano drawn, C3 to C5, a slash bass too, and every Chord keeps at least one', () => {
    const wrong: string[] = [];
    for (const root of roots)
      for (const { suffix } of qualities)
        for (const bass of ['', ...roots.map((r) => '/' + r)]) {
          const name = root + suffix + bass;
          const found = voicings(name);
          if (found.length === 0) wrong.push(`${name}: none`);
          for (const v of found) if (v.keys.some((k) => k < 48 || k > 72)) wrong.push(`${name}: ${v.keys.join(' ')}`);
        }
    expect(wrong).toEqual([]);
  });

  it("leave out a slash Chord's inversion that can't fit C3 to C5 with its bass under it", () => {
    // G B D over A would reach D5 from A3, and A2 is below C3.
    expect(voicings('G/A').map((v) => v.inversion)).toEqual([1, 2]);
  });

  it('spell their notes as the Chord spells them, octave by letter', () => {
    expect(voicings('B7')[0].notes).toEqual(['B3', 'D#4', 'F#4', 'A4']);
    // Cb sounds as B3 but is written in the octave of the C above it.
    expect(voicings('Abm')[0].notes).toEqual(['Ab3', 'Cb4', 'Eb4']);
    expect(voicings('D/F#')[0].notes).toEqual(['F#3', 'A3', 'D4']);
  });
});

describe("Suggest's piano Voicing", () => {
  it("is the Chord's first: root position", () => {
    expect(firstVoicing('G', piano)?.keys).toEqual([55, 59, 62]);
  });
});

describe('hearing a piano Voicing', () => {
  it('sounds its keys together, not strummed, as the guitar is', () => {
    expect(strummed(piano)).toBe(false);
    expect(strummed({ instrument: 'guitar', tuning: [40, 45, 50, 55, 59, 64] })).toBe(true);
  });

  it("plays its keys' pitches low to high, a slash bass first", () => {
    expect(voicingPlucks(voicings('Am/G')[0], piano).map((p) => p.pitch)).toEqual([55, 57, 60, 64]);
  });
});

describe('naming the keys pressed in Name it', () => {
  it('reads them as the guitar reads a shape, the lowest key as the bass', () => {
    expect(nameIt([60, 64, 67], piano)).toEqual({ kind: 'chord', readings: ['C'], notes: ['C', 'E', 'G'] });
    expect(nameIt([67, 52, 60], piano)).toMatchObject({ readings: ['C/E'], notes: ['E', 'C', 'G'] });
  });

  it('lists the notes sounding, low to high, each once, spelled as the best reading spells them', () => {
    expect(nameIt([59, 63, 66, 69, 71], piano)).toEqual({
      kind: 'chord',
      readings: ['B7'],
      notes: ['B', 'D#', 'F#', 'A'],
    });
  });

  it('gives none, with the notes sounding, when no reading fits or no key is pressed', () => {
    expect(nameIt([60, 66, 71], piano)).toEqual({ kind: 'none', notes: ['C', 'F#', 'B'] });
    expect(nameIt([], piano)).toEqual({ kind: 'none', notes: [] });
  });
});

describe("a key's name, as Name it announces it", () => {
  it('is its note, spelled the common way, and its octave: middle C is C4', () => {
    expect(pianoKeyName(48)).toBe('C3');
    expect(pianoKeyName(60)).toBe('C4');
    expect(pianoKeyName(61)).toBe('C#4');
    expect(pianoKeyName(63)).toBe('Eb4');
    expect(pianoKeyName(71)).toBe('B4');
    expect(pianoKeyName(72)).toBe('C5');
  });
});
