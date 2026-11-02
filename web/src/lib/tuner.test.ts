import { describe, expect, it } from 'vitest';
import { tunerStrings } from './tuner';

/** The strings as the Tuner names them, low to high: E2, A2. */
const named = (tuning: string) => tunerStrings(tuning)?.map((s) => s.name);

describe('the strings the Tuner tunes', () => {
  it('are standard tuning’s six, low to high, each in its octave', () => {
    expect(named('Standard')).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  });

  it('are a named tuning’s, a string tuned down taking the octave below', () => {
    expect(named('Drop D')).toEqual(['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(named('Drop C')).toEqual(['C2', 'G2', 'C3', 'F3', 'A3', 'D4']);
    expect(named('Open E')).toEqual(['E2', 'B2', 'E3', 'G#3', 'B3', 'E4']);
  });

  it('are spelt as the tuning writes them', () => {
    expect(named('Half-step down')).toEqual(['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4']);
  });

  it('are a custom tuning’s six notes, each in the octave nearest standard tuning, the lower when two are as near', () => {
    expect(named('C G D G B D')).toEqual(['C2', 'G2', 'D3', 'G3', 'B3', 'D4']);
    // A♭ is four semitones over E2 and eight under, so A♭2, and B♭ one over A2, so B♭2.
    expect(named('Ab Bb D G B E')).toEqual(['Ab2', 'Bb2', 'D3', 'G3', 'B3', 'E4']);
    // B♭ is six semitones either way from E: the lower one.
    expect(named('Bb A D G B E')).toEqual(['Bb1', 'A2', 'D3', 'G3', 'B3', 'E4']);
  });

  it('give a note the octave of its letter, as written: C♭ sounding as B3 is C♭4, and B♯ sounding as C4 is B♯3', () => {
    expect(named('E A D G Cb E')).toEqual(['E2', 'A2', 'D3', 'G3', 'Cb4', 'E4']);
    expect(named('E A D G B# E')).toEqual(['E2', 'A2', 'D3', 'G3', 'B#3', 'E4']);
  });

  it('play each string’s own note, on that string, at A = 440 Hz', () => {
    expect(tunerStrings('Drop D')?.map((s) => s.heard)).toEqual([
      { midi: 38, string: 0 },
      { midi: 45, string: 1 },
      { midi: 50, string: 2 },
      { midi: 55, string: 3 },
      { midi: 59, string: 4 },
      { midi: 64, string: 5 },
    ]);
  });

  it('are none for a tuning that can’t be read, rather than a guess', () => {
    expect(tunerStrings('Nashville')).toBeNull();
    expect(tunerStrings('D A D G B')).toBeNull();
  });
});
