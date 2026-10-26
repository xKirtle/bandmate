import { describe, expect, it } from 'vitest';
import { guitarSamples } from './guitar';
import { pianoSamples } from './piano';
import { fromOnset, sampleFor, type SampleSet } from './samples';

// Which recorded sample a note plays, and how fast (ADR 0030): the nearest
// one, on its own string for an Instrument recorded string by string,
// pitch-shifted to the note by its playback rate. Notes are MIDI note
// numbers: 60 is middle C (C4).

const semitone = 2 ** (1 / 12);

describe("the piano's samples", () => {
  const key = (midi: number) => sampleFor(pianoSamples, { midi });

  it('are the 11 shipped, every minor third from F#2 to C5, served by Bandmate itself', () => {
    expect(pianoSamples.samples.map((s) => pianoSamples.url(s))).toEqual(
      ['Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5'].map(
        (name) => `/samples/piano/${name}.mp3`,
      ),
    );
  });

  it('play a note they have as recorded', () => {
    expect(key(60)).toEqual({ sample: { note: 60 }, rate: 1 });
    expect(key(51)).toEqual({ sample: { note: 51 }, rate: 1 });
  });

  it('play a note between two from the nearer, pitch-shifted to it, in tune', () => {
    // C#4 from C4, a semitone up; D4 from D#4, a semitone down.
    const cSharp = key(61);
    expect(cSharp.sample.note).toBe(60);
    expect(cSharp.rate).toBeCloseTo(semitone, 12);
    const d = key(62);
    expect(d.sample.note).toBe(63);
    expect(d.rate).toBeCloseTo(1 / semitone, 12);
    // A3 is 220 Hz, so A#3 from it sounds at 233.08 Hz, as tuned to A440.
    const aSharp = key(58);
    expect(aSharp.sample.note).toBe(57);
    expect(220 * aSharp.rate).toBeCloseTo(233.08, 2);
  });

  it('play a note below or above them from the nearest end', () => {
    expect(key(40)).toEqual({ sample: { note: 42 }, rate: expect.closeTo(1 / semitone ** 2, 12) });
    expect(key(74)).toEqual({ sample: { note: 72 }, rate: expect.closeTo(semitone ** 2, 12) });
  });
});

describe("the guitar's samples", () => {
  // Strings by number, 0 the thickest: standard tuning's low E is 0, its top E 5.
  const onString = (string: number, midi: number) => sampleFor(guitarSamples, { midi, string });

  it("are the 30 shipped, frets 0, 3, 6, 9 and 12 of each string, in a folder by the string's open note, served by Bandmate itself", () => {
    expect(guitarSamples.samples.map((s) => guitarSamples.url(s))).toEqual(
      [
        ['E2', 'E2 G2 As2 Cs3 E3'],
        ['A2', 'A2 C3 Ds3 Fs3 A3'],
        ['D3', 'D3 F3 Gs3 B3 D4'],
        ['G3', 'G3 As3 Cs4 E4 G4'],
        ['B3', 'B3 D4 F4 Gs4 B4'],
        ['E4', 'E4 G4 As4 Cs5 E5'],
      ].flatMap(([open, notes]) => notes.split(' ').map((name) => `/samples/guitar/${open}/${name}.mp3`)),
    );
  });

  it('play an open string and the 12th fret as recorded, on that string', () => {
    expect(onString(0, 40)).toEqual({ sample: { note: 40, string: 0 }, rate: 1 });
    expect(onString(1, 45)).toEqual({ sample: { note: 45, string: 1 }, rate: 1 });
    expect(onString(5, 64)).toEqual({ sample: { note: 64, string: 5 }, rate: 1 });
    expect(onString(3, 67)).toEqual({ sample: { note: 67, string: 3 }, rate: 1 });
  });

  it("play a note from its own string's recording, not another string's of the same pitch", () => {
    // A2 at the low E's 5th fret, from its A#2 a semitone down, not the open A.
    expect(onString(0, 45)).toEqual({ sample: { note: 46, string: 0 }, rate: expect.closeTo(1 / semitone, 12) });
    // E4 at the B string's 5th fret, from its F4, not the open top E nor the G string's E4.
    expect(onString(4, 64)).toEqual({ sample: { note: 65, string: 4 }, rate: expect.closeTo(1 / semitone, 12) });
    // E3 at the A string's 7th fret, from its F#3: 577555's, not x02555's D string.
    expect(onString(1, 52)).toEqual({ sample: { note: 51, string: 1 }, rate: expect.closeTo(semitone, 12) });
    expect(onString(2, 52)).toEqual({ sample: { note: 53, string: 2 }, rate: expect.closeTo(1 / semitone, 12) });
  });

  it("play a note from its string's nearest sample, never more than a semitone away, in tune", () => {
    // Every fret from 0 to 12 on the low E.
    const fromNotes = Array.from({ length: 13 }, (_, fret) => onString(0, 40 + fret).sample.note);
    expect(fromNotes).toEqual([40, 40, 43, 43, 43, 46, 46, 46, 49, 49, 49, 52, 52]);
    // The A string's B2, 123.47 Hz, from its C3, 130.81 Hz, a semitone down.
    const b = onString(1, 47);
    expect(b.sample).toEqual({ note: 48, string: 1 });
    expect(130.81 * b.rate).toBeCloseTo(123.47, 1);
  });

  it("play a note beyond its string's range, in another tuning, from that string's nearest end", () => {
    // Drop C's low C, 4 semitones under the low E's open string.
    expect(onString(0, 36)).toEqual({ sample: { note: 40, string: 0 }, rate: expect.closeTo(1 / semitone ** 4, 12) });
    // Open E's A string tuned up to B2: its 12th fret, B3, 2 semitones over the A string's A3.
    expect(onString(1, 59)).toEqual({ sample: { note: 57, string: 1 }, rate: expect.closeTo(semitone ** 2, 12) });
  });
});

describe('a decoded sample', () => {
  it('starts 1 ms before its note does, without the silence the encoder put before it', () => {
    // At 8 kHz, 1 ms is 8 frames: 200 frames of silence, a hiss far under
    // the note, then the note.
    const decoded = new Float32Array(400);
    decoded[150] = 0.001;
    decoded[200] = 0.5;
    decoded[201] = -1;
    const trimmed = fromOnset(decoded, 8000);
    expect(trimmed.length).toBe(208);
    expect(trimmed[8]).toBe(0.5);
    expect(trimmed[9]).toBe(-1);
  });

  it('keeps all of one that starts at once', () => {
    const decoded = Float32Array.from([0.5, 0.25, 0]);
    expect(fromOnset(decoded, 8000)).toEqual(decoded);
  });
});

describe('a note equally near two samples', () => {
  const everyTwo = (string?: number): SampleSet => ({
    name: 'test',
    samples: [40, 42, 44].map((note) => ({ note, string })),
    url: (s) => `/${s.note}.mp3`,
    gain: 1,
  });

  it('plays the lower one, pitched up', () => {
    expect(sampleFor(everyTwo(), { midi: 41 })).toEqual({ sample: { note: 40 }, rate: expect.closeTo(semitone, 12) });
    expect(sampleFor(everyTwo(), { midi: 43 })).toEqual({ sample: { note: 42 }, rate: expect.closeTo(semitone, 12) });
  });

  it('on its string, plays the lower one, pitched up', () => {
    const set: SampleSet = { ...everyTwo(), samples: [...everyTwo(0).samples, { note: 41, string: 1 }] };
    expect(sampleFor(set, { midi: 41, string: 0 })).toEqual({
      sample: { note: 40, string: 0 },
      rate: expect.closeTo(semitone, 12),
    });
  });
});
