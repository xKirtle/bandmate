// The pitch the Tuner hears (see the glossary), worked out in the browser
// from what an Input captures: YIN (de Cheveigné and Kawahara, 2002), which
// finds the period a signal repeats at. It's right to a cent or so on a
// string's note, however strong its harmonics, and says it heard nothing,
// rather than guessing, in silence, in noise, or in anything that doesn't
// repeat clearly enough to be a note.

/** The lowest pitch heard, in Hz: under the lowest note a string is tuned to, a B♭1 at 58 Hz. */
const lowest = 50;
/** The highest pitch heard, in Hz: past a guitar's highest fret. */
const highest = 1500;
/** Quieter than this, an RMS of -50 dBFS, it's taken as silence, however clearly it repeats. */
const quietest = 0.003;
/**
 * How clearly a signal must repeat to be a note: YIN's threshold on its
 * normalised difference, 0 for a signal that repeats exactly, about 1 for
 * one that doesn't repeat at all, such as noise.
 */
const clearly = 0.1;

/**
 * The pitch heard in samples captured at sampleRate, in Hz, or null where
 * no note is heard clearly enough. It needs at least a few periods of the
 * lowest note: 4096 samples at 48 kHz holds nearly four of a B♭1.
 */
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  let energy = 0;
  for (const s of samples) energy += s * s;
  if (Math.sqrt(energy / samples.length) < quietest) return null;

  const maxLag = Math.min(Math.ceil(sampleRate / lowest), Math.floor(samples.length / 2));
  const minLag = Math.floor(sampleRate / highest);
  const width = samples.length - maxLag;

  // The difference function, normalised by its running mean: d'(τ).
  const normalised = new Float32Array(maxLag + 1);
  normalised[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let i = 0; i < width; i++) {
      const d = samples[i] - samples[i + lag];
      difference += d * d;
    }
    running += difference;
    normalised[lag] = running > 0 ? (difference * lag) / running : 1;
  }

  // The first dip under the threshold, down to its lowest point: the period.
  let lag = minLag;
  while (lag < maxLag && normalised[lag] >= clearly) lag++;
  if (lag >= maxLag) return null;
  while (lag + 1 < maxLag && normalised[lag + 1] < normalised[lag]) lag++;

  // Between samples, by the parabola through the dip and its neighbours.
  const [before, at, after] = [normalised[lag - 1], normalised[lag], normalised[lag + 1]];
  const curve = before - 2 * at + after;
  const shift = curve > 0 ? (before - after) / (2 * curve) : 0;
  return sampleRate / (lag + shift);
}

/** How long a reading counts towards what's shown, in ms. */
const span = 300;
/** How many readings of a note, in that span, show it: about a tenth of a second's. */
const agreeing = 3;
/** How near two readings are to be of one note, in cents. */
const together = 50;

/**
 * The pitch the Tuner shows, steadied from its readings so it doesn't jump
 * about: a note once it's been read three times in 300 ms, at the middle of
 * its last three readings, so a stray reading, such as an octave, or noise
 * read as notes all over the place, shows nothing, and a string fading for
 * a reading or two still shows. Nothing once no note has been.
 */
export class SteadyPitch {
  #readings: { pitch: number; time: number }[] = [];

  /** Takes a reading, a pitch in Hz or null for nothing heard, at a time in ms; returns the pitch to show, or null. */
  hear(pitch: number | null, time: number): number | null {
    this.#readings = this.#readings.filter((r) => time - r.time < span);
    if (pitch !== null) this.#readings.push({ pitch, time });
    // The latest note read often enough, newest first: a new note takes over once it is.
    for (const reading of [...this.#readings].reverse()) {
      const note = this.#readings.filter((r) => Math.abs(1200 * Math.log2(r.pitch / reading.pitch)) < together);
      if (note.length >= agreeing) return median(note.slice(-agreeing).map((r) => r.pitch));
    }
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
