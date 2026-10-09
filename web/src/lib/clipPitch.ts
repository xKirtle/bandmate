// A Clip's Pitch: how many semitones its audio is moved up or down,
// without changing its Tempo. It's a whole number from −12 to +12, typed
// as one and shown signed, e.g. "−2 st". Plain arithmetic, so the Timeline
// only has to show and set it.
import type { Clip } from './api';
import { formatTempo } from './clipTempo';

/** How far down a Clip's Pitch goes, in semitones. The server checks the same range (MinPitch in the timeline package). */
export const minPitch = -12;
/** How far up a Clip's Pitch goes, in semitones. */
export const maxPitch = 12;

/** The Pitch a number typed sets: whole, and kept within the range. */
export function pitchOf(semitones: number): number {
  // + 0 makes a −0 a 0.
  return Math.min(maxPitch, Math.max(minPitch, Math.round(semitones))) + 0;
}

/** A Pitch as shown, signed, e.g. "−2 st" or "+3 st". */
export function formatPitch(pitch: number): string {
  if (pitch === 0) return '0 st';
  return `${pitch < 0 ? '−' : '+'}${Math.abs(pitch)} st`;
}

/**
 * The badge a Clip shows of its Tempo and Pitch, e.g. "92% · −2 st": each
 * only when it's changed, and none while neither is.
 */
export function stretchBadge({ tempo, pitch }: Pick<Clip, 'tempo' | 'pitch'>): string | null {
  const shown = [...(tempo !== 1 ? [formatTempo(tempo)] : []), ...(pitch !== 0 ? [formatPitch(pitch)] : [])];
  return shown.length > 0 ? shown.join(' · ') : null;
}
