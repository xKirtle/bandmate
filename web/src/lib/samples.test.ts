import { describe, expect, it } from 'vitest';
import { guitarSamples } from './guitar';
import { pianoSamples } from './piano';
import { fromOnset, sampleFor, type SampleSet } from './samples';

// Which recorded sample a note plays, and how fast (ADR 0030): the nearest
// one, pitch-shifted to the note by its playback rate. Keys are MIDI note
// numbers: 60 is middle C (C4).

const semitone = 2 ** (1 / 12);

describe("the piano's samples", () => {
  it('are the 11 shipped, every minor third from F#2 to C5, served by Bandmate itself', () => {
    expect(pianoSamples.notes.map((n) => pianoSamples.url(n))).toEqual(
      ['Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5'].map(
        (name) => `/samples/piano/${name}.mp3`,
      ),
    );
  });

  it('play a note they have as recorded', () => {
    expect(sampleFor(pianoSamples, 60)).toEqual({ sample: 60, rate: 1 });
    expect(sampleFor(pianoSamples, 51)).toEqual({ sample: 51, rate: 1 });
  });

  it('play a note between two from the nearer, pitch-shifted to it, in tune', () => {
    // C#4 from C4, a semitone up; D4 from D#4, a semitone down.
    const cSharp = sampleFor(pianoSamples, 61);
    expect(cSharp.sample).toBe(60);
    expect(cSharp.rate).toBeCloseTo(semitone, 12);
    const d = sampleFor(pianoSamples, 62);
    expect(d.sample).toBe(63);
    expect(d.rate).toBeCloseTo(1 / semitone, 12);
    // A3 is 220 Hz, so A#3 from it sounds at 233.08 Hz, as tuned to A440.
    const aSharp = sampleFor(pianoSamples, 58);
    expect(aSharp.sample).toBe(57);
    expect(220 * aSharp.rate).toBeCloseTo(233.08, 2);
  });

  it('play a note below or above them from the nearest end', () => {
    expect(sampleFor(pianoSamples, 40)).toEqual({ sample: 42, rate: expect.closeTo(1 / semitone ** 2, 12) });
    expect(sampleFor(pianoSamples, 74)).toEqual({ sample: 72, rate: expect.closeTo(semitone ** 2, 12) });
  });
});

describe("the guitar's samples", () => {
  it('are the 19 shipped, every 2 semitones from D2 to D5, served by Bandmate itself', () => {
    expect(guitarSamples.notes.map((n) => guitarSamples.url(n))).toEqual(
      [
        'D2',
        'E2',
        'Fs2',
        'Gs2',
        'As2',
        'C3',
        'D3',
        'E3',
        'Fs3',
        'Gs3',
        'As3',
        'C4',
        'D4',
        'E4',
        'Fs4',
        'Gs4',
        'As4',
        'C5',
        'D5',
      ].map((name) => `/samples/guitar/${name}.mp3`),
    );
  });

  it("play standard tuning's open low E, D and high E as recorded", () => {
    expect(sampleFor(guitarSamples, 40)).toEqual({ sample: 40, rate: 1 });
    expect(sampleFor(guitarSamples, 50)).toEqual({ sample: 50, rate: 1 });
    expect(sampleFor(guitarSamples, 64)).toEqual({ sample: 64, rate: 1 });
  });

  it('play an odd note from the sample a semitone under it, in tune', () => {
    // The open A string, A2, is 110 Hz, from G#2 a semitone up.
    const a = sampleFor(guitarSamples, 45);
    expect(a.sample).toBe(44);
    expect(103.83 * a.rate).toBeCloseTo(110, 1);
    // The open G and B strings, G3 and B3, likewise.
    expect(sampleFor(guitarSamples, 55)).toEqual({ sample: 54, rate: expect.closeTo(semitone, 12) });
    expect(sampleFor(guitarSamples, 59)).toEqual({ sample: 58, rate: expect.closeTo(semitone, 12) });
  });

  it('play a note below D2 or above D5 from the nearest end: Drop C, and the top string at the 12th fret', () => {
    expect(sampleFor(guitarSamples, 36)).toEqual({ sample: 38, rate: expect.closeTo(1 / semitone ** 2, 12) });
    expect(sampleFor(guitarSamples, 76)).toEqual({ sample: 74, rate: expect.closeTo(semitone ** 2, 12) });
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
  it('plays the lower one, pitched up', () => {
    const everyTwo: SampleSet = { name: 'test', notes: [40, 42, 44], url: (n) => `/${n}.mp3`, gain: 1 };
    expect(sampleFor(everyTwo, 41)).toEqual({ sample: 40, rate: expect.closeTo(semitone, 12) });
    expect(sampleFor(everyTwo, 43)).toEqual({ sample: 42, rate: expect.closeTo(semitone, 12) });
  });
});
