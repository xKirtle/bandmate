import { describe, expect, it } from 'vitest';
import { tunerPeg, tunerReading, tunerStrings, tunerWaveHeight, tunerWavelength, tunerWay } from './tuner';

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

/** A note's frequency at A = 440 Hz, from its MIDI note number, so many cents sharp of it. */
const hz = (midi: number, cents = 0) => 440 * 2 ** ((midi - 69 + cents / 100) / 12);

/** What the Tuner reads from a frequency heard, tuned to a Tuning: its string by number, its cents to a tenth. */
function read(tuning: string, frequency: number) {
  const reading = tunerReading(frequency, tunerStrings(tuning)!);
  return { ...reading, string: reading.string.number, cents: Math.round(reading.cents * 10) / 10 || 0 };
}

describe('what the Tuner reads from a note heard', () => {
  it('is the nearest string, in tune on its note', () => {
    expect(read('Standard', 110)).toEqual({ heard: 'A2', string: '5th', cents: 0, inTune: true });
    expect(read('Standard', 329.63)).toEqual({ heard: 'E4', string: '1st', cents: 0, inTune: true });
  });

  it('is how many cents sharp or flat of the nearest string’s note it is, at A = 440 Hz', () => {
    expect(read('Standard', hz(40, 12))).toEqual({ heard: 'E2', string: '6th', cents: 12, inTune: false });
    expect(read('Standard', hz(55, -30))).toEqual({ heard: 'G3', string: '3rd', cents: -30, inTune: false });
  });

  it('is in tune within 5 cents either way', () => {
    expect(read('Standard', hz(45, 4.9)).inTune).toBe(true);
    expect(read('Standard', hz(45, -4.9)).inTune).toBe(true);
    expect(read('Standard', hz(45, 5.1)).inTune).toBe(false);
    expect(read('Standard', hz(45, -5.1)).inTune).toBe(false);
  });

  it('names the note heard, which may not be the string’s', () => {
    // A low E tuned down past E♭ is still nearest the 6th string.
    expect(read('Standard', hz(39, -10))).toEqual({ heard: 'Eb2', string: '6th', cents: -110, inTune: false });
    expect(read('Standard', hz(42))).toEqual({ heard: 'F#2', string: '6th', cents: 200, inTune: false });
  });

  it('names a note heard more than halfway to the next one by that one', () => {
    expect(read('Standard', hz(40, 60))).toMatchObject({ heard: 'F2', string: '6th', cents: 60 });
  });

  it('measures against the Tuning’s strings: Drop D’s low D is in tune', () => {
    expect(read('Drop D', hz(38))).toEqual({ heard: 'D2', string: '6th', cents: 0, inTune: true });
    expect(read('Standard', hz(38))).toMatchObject({ heard: 'D2', string: '6th', cents: -200 });
  });

  it('names the note heard as the Tuning writes its string', () => {
    expect(read('Half-step down', hz(49))).toEqual({ heard: 'Db3', string: '4th', cents: 0, inTune: true });
    // A note that's no string's is spelt the common way.
    expect(read('Half-step down', hz(49, 100))).toMatchObject({ heard: 'D3', string: '4th', cents: 100 });
    expect(read('Half-step down', hz(37))).toMatchObject({ heard: 'C#2', string: '6th', cents: -200 });
    expect(read('Open E', hz(56))).toMatchObject({ heard: 'G#3', string: '3rd' });
  });

  it('is whichever string’s note is nearer, by pitch', () => {
    // B3 is the 2nd string's and E4 the 1st's: C4 is a semitone over B3, D4 two under E4.
    expect(read('Standard', hz(60))).toMatchObject({ heard: 'C4', string: '2nd', cents: 100 });
    expect(read('Standard', hz(62))).toMatchObject({ heard: 'D4', string: '1st', cents: -200 });
  });

  it('is the lower string where a note is as near two', () => {
    // A2 and D3 are five semitones apart: halfway is 250 cents over A2.
    expect(read('Standard', hz(45, 250))).toMatchObject({ string: '5th', cents: 250 });
  });
});

describe('what the Tuner reads, held to a string', () => {
  /** What it reads tuned to a Tuning, held to the string at that place low to high (0 is the low string). */
  function heldTo(tuning: string, held: number, frequency: number) {
    const strings = tunerStrings(tuning)!;
    const reading = tunerReading(frequency, strings, strings[held]);
    return { ...reading, string: reading.string.number, cents: Math.round(reading.cents * 10) / 10 || 0 };
  }

  it('measures against the held string, however near another string’s note it is', () => {
    // Changing to Drop D: the low E, still at E2, is held to its D2, 200 cents sharp of it.
    expect(heldTo('Drop D', 0, hz(40))).toEqual({ heard: 'E2', string: '6th', cents: 200, inTune: false });
    // A low E tuned up past F♯ to G2 is nearer A2, the 5th's, but held to the 6th it's 300 cents sharp of E2.
    expect(heldTo('Standard', 0, hz(43))).toEqual({ heard: 'G2', string: '6th', cents: 300, inTune: false });
    // Flat, as far off as it is.
    expect(heldTo('Standard', 5, hz(55))).toEqual({ heard: 'G3', string: '1st', cents: -900, inTune: false });
  });

  it('is in tune on the held string’s note, within 5 cents', () => {
    expect(heldTo('Drop D', 0, hz(38, 3))).toMatchObject({ string: '6th', inTune: true });
  });

  it('is the nearest string with none held', () => {
    expect(tunerReading(hz(43), tunerStrings('Standard')!, null).string.number).toBe('5th');
    expect(tunerReading(hz(43), tunerStrings('Standard')!).string.number).toBe('5th');
  });
});

describe('where each string’s peg is on the headstock', () => {
  /** Each side's pegs, top to bottom, by string name, in standard tuning. */
  const sides = (leftHanded: boolean) => {
    const strings = tunerStrings('Standard')!;
    const side = (column: 'left' | 'right') =>
      strings
        .map((s, i) => ({ name: s.name, ...tunerPeg(i, leftHanded) }))
        .filter((p) => p.side === column)
        .sort((a, b) => a.row - b.row)
        .map((p) => p.name);
    return { left: side('left'), right: side('right') };
  };

  it('is three a side, the low strings on the left, each outer string nearest the nut, at the foot, as a 3+3 headstock’s', () => {
    expect(sides(false)).toEqual({ left: ['D3', 'A2', 'E2'], right: ['G3', 'B3', 'E4'] });
  });

  it('is mirrored for a left-handed player, the low strings on the right', () => {
    expect(sides(true)).toEqual({ left: ['G3', 'B3', 'E4'], right: ['D3', 'A2', 'E2'] });
  });
});

describe('the heard wave’s wavelength, against the target’s', () => {
  /** The heard wave's wavelength, the target's being 1, for an A2 heard so many cents off in standard tuning. */
  const wavelength = (cents: number) => tunerWavelength(tunerReading(hz(45, cents), tunerStrings('Standard')!));

  it('is shorter by 1% each cent sharp, and longer by 1% each cent flat', () => {
    expect(wavelength(12)).toBeCloseTo(0.88, 6);
    expect(wavelength(-12)).toBeCloseTo(1.12, 6);
    expect(wavelength(30)).toBeCloseTo(0.7, 6);
  });

  it('is the target’s in tune, within 5 cents either way, so it lies on it', () => {
    expect(wavelength(0)).toBe(1);
    expect(wavelength(4)).toBe(1);
    expect(wavelength(-4)).toBe(1);
  });

  it('goes no further than 50 cents either way, as the meter does', () => {
    expect(wavelength(50)).toBeCloseTo(0.5, 6);
    expect(wavelength(120)).toBeCloseTo(0.5, 6);
    expect(wavelength(-900)).toBeCloseTo(1.5, 6);
  });
});

describe('the heard wave’s height, against the target’s', () => {
  it('is the target’s for a string played loud, from a loudness of an eighth of full scale', () => {
    expect(tunerWaveHeight(0.125)).toBe(1);
    expect(tunerWaveHeight(0.6)).toBe(1);
  });

  it('shrinks as the string fades, in step with how loud it is', () => {
    expect(tunerWaveHeight(0.0625)).toBeCloseTo(0.5, 6);
    expect(tunerWaveHeight(0.05)).toBeCloseTo(0.4, 6);
  });

  it('keeps to at least 15% of the target’s, so a quiet string still shows', () => {
    expect(tunerWaveHeight(0.01)).toBeCloseTo(0.15, 6);
    expect(tunerWaveHeight(0)).toBeCloseTo(0.15, 6);
  });
});

describe('which way to tune', () => {
  const standard = tunerStrings('Standard')!;
  /** The way to tune an A2 heard so many cents off in standard tuning. */
  const way = (cents: number) => tunerWay(tunerReading(hz(45, cents), standard));

  it('is up when flat, and down when sharp, to the note', () => {
    expect(way(-12)).toBe('up');
    expect(way(-6)).toBe('up');
    expect(way(12)).toBe('down');
    expect(way(6)).toBe('down');
    expect(way(-120)).toBe('up');
  });

  it('is none in tune, within 5 cents either way, or with nothing heard', () => {
    expect(way(0)).toBeNull();
    expect(way(4)).toBeNull();
    expect(way(-4)).toBeNull();
    expect(tunerWay(null)).toBeNull();
  });

  it('is to the note of the string held, however far off', () => {
    // A G2 is under the 5th string's A2, nearest it, but over the 6th's E2.
    expect(tunerWay(tunerReading(hz(43), standard))).toBe('up');
    expect(tunerWay(tunerReading(hz(43), standard, standard[0]))).toBe('down');
  });
});
