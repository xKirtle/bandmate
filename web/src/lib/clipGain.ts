// A Clip's Gain: how much louder or quieter it plays, in dB, before its
// Track's volume applies. Its range goes higher than a Track's volume's,
// to lift a quiet recording on its own, and like a Track, all the way down
// it's quiet, never silent. It's set by dragging
// the gain line across the Clip, linear in dB: 0 dB in the middle, the top
// of the range at the top and the bottom at the bottom. Plain arithmetic, so
// the Timeline only has to draw and play it.
import { formatVolume } from './mixer';

/** A Clip's lowest Gain, in dB. The server checks the same range (MinGain in the timeline package). */
export const minGain = -36;
/** A Clip's highest Gain, in dB. */
export const maxGain = 36;

// A Shift-drag goes this much as far, for fine changes.
const fine = 0.1;

/** A Gain as a factor of the Clip's audio. */
export function gainFactor(gain: number): number {
  return 10 ** (gain / 20);
}

/** How far down the Clip its gain line is, from 0 (the top) to 1 (the bottom). */
export function gainLineAt(gain: number): number {
  return (maxGain - gain) / (maxGain - minGain);
}

/** A Gain kept within the range, in tenths of a dB. */
export function clampGain(gain: number): number {
  return Math.round(Math.min(maxGain, Math.max(minGain, gain)) * 10) / 10;
}

/**
 * Where dragging the gain line moves a Clip's Gain from `from`: by dy
 * pixels, down if positive, across a Clip `height` pixels tall, the line
 * following the pointer, or with `isFine`, a tenth as far.
 */
export function draggedGain(from: number, dy: number, height: number, isFine: boolean): number {
  if (height <= 0) return from;
  const by = (-dy / height) * (maxGain - minGain) * (isFine ? fine : 1);
  return clampGain(from + by);
}

/** A Gain as shown, e.g. "+3 dB" or "−4.5 dB", to the tenth. */
export function formatGain(gain: number): string {
  // Not "−0 dB" for a hair under 0.
  return formatVolume(Math.round(gain * 10) / 10 || 0);
}

/** Whether a waveform peak goes over full scale at a Clip's Gain and its Track's volume, so it clips as it plays. */
export function overFullScale(peak: number, gain: number, volume: number): boolean {
  return peak * gainFactor(gain + volume) > 1;
}

/** A waveform peak, from 0 to 1, as the Clip's Gain makes it sound, drawn no higher than full scale. */
export function heardPeak(peak: number, gain: number): number {
  return Math.min(1, peak * gainFactor(gain));
}
