// The recorded samples an Instrument sounds from (ADR 0030): a few notes of
// it, recorded, shipped with Bandmate in public/samples/ and served by its
// own server, never fetched from anyone else's. Each note heard plays the
// nearest one, pitch-shifted to it by playing it faster or slower.
// web/scripts/samples.sh makes the files.

/** One Instrument's recorded samples. */
export interface SampleSet {
  /** The Instrument it's of, as a toast saying it couldn't be heard labels it: "Piano". */
  name: string;
  /** The MIDI note number of each sample, low to high. */
  notes: readonly number[];
  /** Where a sample is served, by its note. */
  url(note: number): string;
  /** How loud its samples play: matched to the guitar's strum, with no Voicing clipping. */
  gain: number;
}

const sharpNames = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

/** A sample's file name, without its extension, as the files are named: Fs2 for F#2, C4 for middle C. */
export const sampleFileName = (note: number) => sharpNames[note % 12] + (Math.floor(note / 12) - 1);

/** Where a set's sample is served: under samples/ in the folder named, as the web app's own file. */
export const samplesIn = (folder: string) => (note: number) =>
  `${import.meta.env.BASE_URL}samples/${folder}/${sampleFileName(note)}.mp3`;

/**
 * A decoded sample from its note's onset: the first frame above 0.3% of its
 * peak, keeping 1 ms before it. MP3 starts with about 25 ms of the encoder's
 * silence, which would make a strum late and ragged.
 */
export function fromOnset(decoded: Float32Array, sampleRate: number): Float32Array {
  let peak = 0;
  for (const s of decoded) peak = Math.max(peak, Math.abs(s));
  let onset = 0;
  while (onset < decoded.length && Math.abs(decoded[onset]) <= 0.003 * peak) onset++;
  return decoded.slice(Math.max(0, onset - Math.round(sampleRate / 1000)));
}

/**
 * Which sample plays a note, and at what playback rate, so it sounds at the
 * note: the nearest sample, or the lower of two equally near, pitched up. A
 * note outside the set plays from its nearest end.
 */
export function sampleFor(set: SampleSet, midi: number): { sample: number; rate: number } {
  let sample = set.notes[0];
  for (const note of set.notes) if (Math.abs(note - midi) < Math.abs(sample - midi)) sample = note;
  return { sample, rate: 2 ** ((midi - sample) / 12) };
}
