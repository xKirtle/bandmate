// The piano: an Instrument the Chord Finder plays on (ADR 0012). Its
// Voicings are one hand's: root position and each inversion of a Chord, in
// close position, round middle C, so each fits the keyboard drawn, C3 to C5.
// A slash Chord lists the inversion with its bass lowest first, then the
// others with the bass under them, in the left hand. Keys are MIDI note
// numbers: 60 is middle C (C4).

import { commonNote, type Chord, type Tone } from './chordTheory';
import type { Instrument, Pluck } from './instrument';

/** The lowest key a piano Voicing is drawn on, and played within: C3. */
export const lowestKey = 48;
/** The highest: C5, two octaves above. */
export const highestKey = 72;

/** One way to play a Chord on the piano. */
export interface PianoVoicing {
  /** Every key pressed, low to high. */
  keys: number[];
  /** The left hand's keys, among them: a slash bass under the Chord, or none. */
  left: number[];
  /** Which of the Chord's tones is lowest in the right hand, counted up from the root in close position: 0 for root position, 1 for the first inversion… */
  inversion: number;
  /** Each key's note, low to high, spelled as the Chord spells it, with its octave: D#4 in B7. */
  notes: string[];
}

const pitchClass = (key: number) => ((key % 12) + 12) % 12;

/** The keys pressed on a piano, as MIDI note numbers. */
export type PianoKeys = readonly number[];

/** Whether a key is a black one. */
export const isBlackKey = (key: number) => [1, 3, 6, 8, 10].includes(pitchClass(key));

/** A key's note, spelled the common way, as notes no Chord spells are, with its octave: middle C is C4, the key above it C#4. */
export const pianoKeyName = (key: number) => commonNote(key) + (Math.floor(key / 12) - 1);

/** Middle C, C4. */
export const middleC = 60;
/**
 * Where the right hand's lowest key is placed as near as fits: between
 * middle C and the C# above, so it lands from G3 to F#4, round middle C.
 */
const middle = middleC + 0.5;

/**
 * The tones one hand plays: every tone, unless there are more than four,
 * when the optional ones (the fifth, the ninth of an 11) are left out. In
 * close position, each within the octave above the root, low to high, so a
 * ninth sits next to the root.
 */
function handTones(chord: Chord): Tone[] {
  const tones = chord.quality.tones.length > 4 ? chord.quality.tones.filter((t) => !t.optional) : chord.quality.tones;
  return [...tones].sort((a, b) => (a.semitones % 12) - (b.semitones % 12));
}

/** Stacks pitch classes upwards, each the next key above the last, the first on `from`. */
function stack(pitchClasses: number[], from: number): number[] {
  const keys = [from];
  for (const pc of pitchClasses.slice(1)) {
    const last = keys[keys.length - 1];
    keys.push(last + 1 + pitchClass(pc - last - 1));
  }
  return keys;
}

/**
 * An inversion's keys, with the slash bass under it, if any: the right hand
 * as near middle C as fits between C3 and C5, its lowest key nearest it, and
 * the bass the nearest key under the right hand. Null if it can't fit.
 */
function place(pitchClasses: number[], bass: number | null): number[] | null {
  const placements = [-1, 0]
    .map((octave) => {
      // The right hand's lowest key in the octave from middle C, or the one
      // below it: an octave higher would start on C5 or above.
      const from = middleC + 12 * octave + pitchClass(pitchClasses[0] - middleC);
      const right = stack(pitchClasses, from);
      return bass === null ? right : [from - 1 - pitchClass(from - 1 - bass), ...right];
    })
    .filter((keys) => keys[0] >= lowestKey && keys[keys.length - 1] <= highestKey);
  const rightLowest = (keys: number[]) => keys[bass === null ? 0 : 1];
  placements.sort((a, b) => Math.abs(rightLowest(a) - middle) - Math.abs(rightLowest(b) - middle));
  return placements[0] ?? null;
}

/** Each of a Chord's notes, as its pitch class, to how the Chord spells it. */
function spellingOf(chord: Chord): Map<number, string> {
  const spelling = new Map(chord.quality.tones.map((t, i) => [pitchClass(chord.root + t.semitones), chord.notes[i]]));
  if (chord.bass !== null && chord.bassName && !spelling.has(chord.bass)) spelling.set(chord.bass, chord.bassName);
  return spelling;
}

/** How far a spelling's accidentals move its letter, in semitones: +1 for #, -1 for b. */
const accidentals = (note: string) => [...note.slice(1)].reduce((n, a) => n + (a === '#' ? 1 : a === 'b' ? -1 : 0), 0);

/** A key's note as spelled, with its octave, which follows the letter: Cb4 sounds as B3. */
function spelledKey(key: number, note: string): string {
  return note + (Math.floor((key - accidentals(note)) / 12) - 1);
}

/**
 * A Chord's piano Voicings, one hand's, best first: root position, then each
 * inversion in turn. A slash Chord's inversion with its bass lowest comes
 * first, then the rest, each with the bass under it in the left hand. An
 * inversion that can't fit between C3 and C5 with its bass is left out, but
 * every Chord keeps one, as each of these spans under an octave, which two
 * octaves always hold: a Chord's inversions without a bass; a slash Chord's
 * inversion on its bass, when the bass is one of the hand's tones; and
 * otherwise the inversion on the next tone above the bass, with the bass
 * under it.
 */
function pianoVoicings(chord: Chord): PianoVoicing[] {
  const tones = handTones(chord).map((t) => pitchClass(chord.root + t.semitones));
  const spelling = spellingOf(chord);
  const voicing = (inversion: number, keys: number[], left: number[]): PianoVoicing => ({
    keys,
    left,
    inversion,
    notes: keys.map((k) => spelledKey(k, spelling.get(pitchClass(k)) ?? '')),
  });
  const inversions = tones.map((_, i) => [...tones.slice(i), ...tones.slice(0, i)]);
  const onBass = chord.bass === null ? -1 : inversions.findIndex((order) => order[0] === chord.bass);
  const found = inversions.flatMap((order, i) => {
    const bass = chord.bass === null || i === onBass ? null : chord.bass;
    const keys = place(order, bass);
    return keys ? [voicing(i, keys, bass === null ? [] : [keys[0]])] : [];
  });
  const first = found.findIndex((v) => v.inversion === onBass);
  if (first > 0) found.unshift(...found.splice(first, 1));
  return found;
}

/** How bright a key sounds: darker low down, brighter up high, so the plucked tone it's heard with for now follows the keyboard. */
const brightness = (key: number) => Math.min(1, Math.max(0, (key - lowestKey) / (highestKey - lowestKey)));

/**
 * The piano. The notes placed on it are its keys, and Hear sounds them
 * together, not strummed. A preferred Voicing is kept by its inversion,
 * which of the Chord's tones is lowest, not by its keys. It counts the
 * hand's tones, so it survives the keys' placement being tuned, but not a
 * change to which optional tones a Chord of more than four notes leaves out.
 */
export function piano(): Instrument<PianoVoicing, PianoKeys, number> {
  return {
    voicings: pianoVoicings,
    placement: (voicing) => voicing.keys,
    plucks: (keys): Pluck[] =>
      [...keys].sort((a, b) => a - b).map((pitch) => ({ pitch, brightness: brightness(pitch) })),
    strummed: false,
    preferredStorageKey: 'bandmate.preferredVoicings.piano',
    preference: (voicing) => voicing.inversion,
    prefers: (voicing, inversion) => voicing.inversion === inversion,
    isPreference: (kept): kept is number => Number.isInteger(kept) && (kept as number) >= 0,
  };
}
