import { describe, expect, it } from 'vitest';
import { detectPitch, LastHeard, loudness, SteadyPitch } from './pitch';

const rate = 48000;
/** How many samples the Tuner listens to at a time: 4096, about 85 ms. */
const size = 4096;

/** How far apart two frequencies are, in cents. */
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/**
 * A tone at a frequency, `size` samples long: its harmonics' amplitudes,
 * the fundamental first, each starting at a phase of its own.
 */
function tone(frequency: number, harmonics = [1], sampleRate = rate): Float32Array {
  const samples = new Float32Array(size);
  harmonics.forEach((amplitude, h) => {
    const phase = (h * 1.7) % (2 * Math.PI);
    for (let i = 0; i < size; i++)
      samples[i] += amplitude * 0.3 * Math.sin((2 * Math.PI * frequency * (h + 1) * i) / sampleRate + phase);
  });
  return samples;
}

/** Random noise, the same every run, at a peak amplitude. */
function noise(amplitude: number, seed = 1): Float32Array {
  let state = seed;
  const samples = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    // A small LCG: plain, and the same on every run.
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    samples[i] = (state / 2 ** 32 - 0.5) * 2 * amplitude;
  }
  return samples;
}

const mixed = (a: Float32Array, b: Float32Array) => a.map((s, i) => s + b[i]);

/** A plucked string's harmonics: a strong second and third, fading after. */
const plucked = [0.6, 1, 0.8, 0.5, 0.35, 0.2, 0.12, 0.08];

// From the lowest note a string is ever tuned to, a B♭1 six semitones under
// the low E, to the 12th fret of the high E, and past it.
const range = [
  ['B♭1', 58.27],
  ['C2', 65.41],
  ['D2', 73.42],
  ['E2', 82.41],
  ['A2', 110],
  ['D3', 146.83],
  ['G3', 196],
  ['B3', 246.94],
  ['E4', 329.63],
  ['A4', 440],
  ['E5', 659.26],
  ['C6', 1046.5],
] as const;

describe('the pitch the Tuner hears', () => {
  for (const [name, frequency] of range) {
    it(`is a pure ${name} to within a cent`, () => {
      expect(Math.abs(cents(detectPitch(tone(frequency), rate)!, frequency))).toBeLessThan(1);
    });

    it(`is a plucked ${name}, its harmonics louder than it, over noise, to within 3 cents`, () => {
      const heard = detectPitch(mixed(tone(frequency, plucked), noise(0.05)), rate);
      expect(Math.abs(cents(heard!, frequency))).toBeLessThan(3);
    });
  }

  it('is as right a few cents off a note, sharp or flat', () => {
    for (const off of [-23, -7, 4, 18]) {
      const frequency = 110 * 2 ** (off / 1200);
      expect(Math.abs(cents(detectPitch(tone(frequency, plucked), rate)!, frequency))).toBeLessThan(1);
    }
  });

  it('is as right at 44.1 kHz', () => {
    for (const frequency of [82.41, 196, 329.63]) {
      const heard = detectPitch(tone(frequency, plucked, 44100), 44100);
      expect(Math.abs(cents(heard!, frequency))).toBeLessThan(1);
    }
  });

  it('is a quiet note’s too, as a string fades', () => {
    const quiet = tone(110, plucked).map((s) => s * 0.03);
    expect(Math.abs(cents(detectPitch(quiet, rate)!, 110))).toBeLessThan(3);
  });

  it('is nothing in silence', () => {
    expect(detectPitch(new Float32Array(size), rate)).toBeNull();
  });

  it('is nothing in a hiss too quiet to be a note', () => {
    expect(detectPitch(noise(0.002), rate)).toBeNull();
  });

  it('is nothing in noise, however loud', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(detectPitch(noise(0.5, seed), rate)).toBeNull();
  });
});

/** What a SteadyPitch shows after each reading, given as pitches 50 ms apart, null for nothing heard. */
function shown(readings: (number | null)[]): (number | null)[] {
  const steady = new SteadyPitch();
  return readings.map((pitch, i) => steady.hear(pitch, i * 50));
}

describe('the pitch the Tuner shows', () => {
  it('is a note once it’s been heard three times running, about a tenth of a second', () => {
    expect(shown([110, 110, 110, 110])).toEqual([null, null, 110, 110]);
  });

  it('is the middle of the last few readings, so it doesn’t jitter', () => {
    expect(shown([110, 111, 109, 110.5])).toEqual([null, null, 110, 110.5]);
  });

  it('isn’t moved by a reading far off the rest, such as an octave', () => {
    expect(shown([110, 110, 110, 220, 110])).toEqual([null, null, 110, 110, 110]);
  });

  it('isn’t a reading heard once among nothing', () => {
    expect(shown([null, null, 110, null, null, null])).toEqual([null, null, null, null, null, null]);
  });

  it('is nothing while the readings jump about, as in noise', () => {
    expect(shown([110, 180, 75, 300, 140, 95])).toEqual([null, null, null, null, null, null]);
  });

  it('holds through a reading or two of nothing, as a string fades, then goes', () => {
    expect(shown([110, 110, 110, null, null, null, null, null, null, null])).toEqual([
      null,
      null,
      110,
      110,
      110,
      110,
      null,
      null,
      null,
      null,
    ]);
  });

  it('moves to another note once that’s heard three times running', () => {
    expect(shown([110, 110, 110, 147, 147, 147, 147])).toEqual([null, null, 110, 110, 110, 147, 147]);
  });
});

/**
 * A plucked A2 dying away over about three seconds, read every 50 ms, then
 * a second of silence: in tune while it rings, sagging flat as it fades, up
 * to 10 cents flat by the time it's too quiet to hear, as a string's tail can.
 */
function fading(): Float32Array[] {
  return Array.from({ length: 100 }, (_, i) => {
    const time = i * 0.05;
    if (time >= 4) return new Float32Array(size);
    const strength = Math.exp(-time / 0.6);
    const sag = strength >= 0.03 ? 0 : -15 * (1 - strength / 0.03);
    return tone(110 * 2 ** (sag / 1200), plucked).map((s) => s * strength);
  });
}

/** What the Tuner shows after each of a run of samples read 50 ms apart, and what it keeps once the note's faded. */
function heard(frames: Float32Array[], keeper = new LastHeard()) {
  const steady = new SteadyPitch();
  return frames.map((samples, i) => {
    const detected = detectPitch(samples, rate);
    const shown = steady.hear(detected, i * 50);
    return { shown, kept: keeper.hear(detected, shown, loudness(samples)) };
  });
}

const silence = (n: number) => Array<Float32Array>(n).fill(new Float32Array(size));
const ringing = (frequency: number, n: number) => Array<Float32Array>(n).fill(tone(frequency, plucked));

describe('the reading the Tuner keeps once a note fades', () => {
  it('is nothing before any note is heard, in silence or a hiss', () => {
    expect(heard([...silence(5), noise(0.002), noise(0.5)]).map((r) => r.kept)).toEqual(Array(7).fill(null));
  });

  it('is nothing while a note shows: what’s heard shows instead', () => {
    expect(heard(ringing(110, 6)).map((r) => r.kept)).toEqual(Array(6).fill(null));
  });

  it('is a note’s last reading where it stops short rather than fading', () => {
    expect(Math.abs(cents(heard([...ringing(147, 10), ...silence(10)]).at(-1)!.kept!, 147))).toBeLessThan(1);
  });

  it('goes once the next note shows, which is kept in its turn once it fades', () => {
    const readings = heard([...ringing(110, 10), ...silence(10), ...ringing(147, 10), ...silence(10)]);
    expect(Math.abs(cents(readings[19].kept!, 110))).toBeLessThan(1);
    const next = readings.findIndex((r, i) => i > 19 && r.shown !== null);
    expect(readings[next].kept).toBeNull();
    expect(Math.abs(cents(readings.at(-1)!.kept!, 147))).toBeLessThan(1);
  });

  it('is nothing once forgotten, till another note fades', () => {
    const keeper = new LastHeard();
    heard([...ringing(110, 10), ...silence(5)], keeper);
    keeper.forget();
    expect(heard(silence(5), keeper).map((r) => r.kept)).toEqual(Array(5).fill(null));
    expect(Math.abs(cents(heard([...ringing(147, 10), ...silence(5)], keeper).at(-1)!.kept!, 147))).toBeLessThan(1);
  });

  it('is where a dying note was while well above its fade, not its flat tail', () => {
    const readings = heard(fading());
    const gone = readings.length - [...readings].reverse().findIndex((r) => r.shown !== null);
    // The last it showed before it faded was flat, so that's not what's kept.
    expect(cents(readings[gone - 1].shown!, 110)).toBeLessThan(-5);
    const kept = readings.at(-1)!.kept!;
    expect(Math.abs(cents(kept, 110))).toBeLessThan(1);
    // Kept from when the note went, till the end of the silence.
    expect(readings.slice(gone).every((r) => r.kept === kept)).toBe(true);
  });
});
