// A Clip's Fades: its fade in, rising from silence at its start, and its
// fade out, falling to silence at its end, each measured in seconds from
// that edge as trimmed. Together they never run longer than the Clip.
//
// They follow one fixed curve, equal-power (a quarter of a sine), which
// sounds even all the way through, where one straight in amplitude lingers
// then drops at the end. On the Clip they're drawn as straight slopes, and
// set by dragging the dots at the gain line's ends. Plain arithmetic, so the
// Timeline only has to draw and play them.
import type { ClipFades } from './api';

/** A Clip's Fades where it is: from its start and up to its end, on the Timeline, in seconds. */
export interface PlacedFades extends ClipFades {
  start: number;
  end: number;
}

// How many points a second a Fade's curve is played from, so it's smooth.
const pointsPerSecond = 200;

/** How loud a Fade is, from 0 (silent) to 1 (as the Clip is), a share x of the way from its silent end. */
function curve(x: number): number {
  return Math.sin((Math.min(1, Math.max(0, x)) * Math.PI) / 2);
}

/** How loud a Clip's Fades make it at time t, from 0 (silent) to 1 (untouched). */
export function fadeGainAt(fades: PlacedFades, t: number): number {
  const { start, end, fadeIn, fadeOut } = fades;
  if (fadeIn > 0 && t < start + fadeIn) return curve((t - start) / fadeIn);
  if (fadeOut > 0 && t > end - fadeOut) return curve((end - t) / fadeOut);
  return 1;
}

/**
 * A Clip's Fades once it's length seconds long: as they are if they fit,
 * or else each shortened by the same share, to meet. The server does the
 * same (Fades.fitted in the timeline package).
 */
export function fitFades(fades: ClipFades, length: number): ClipFades {
  const both = fades.fadeIn + fades.fadeOut;
  if (both <= length) return fades;
  const share = length / both;
  const fadeIn = fades.fadeIn * share;
  return { fadeIn, fadeOut: Math.min(fades.fadeOut * share, length - fadeIn) };
}

/**
 * How long a Fade is with its dot dragged to `at` seconds in from its edge,
 * on a Clip `length` seconds long whose other Fade is `other` seconds: none
 * back where the dot `rests` without one, or nearer the edge, and never
 * past the other Fade.
 */
export function draggedFade(at: number, other: number, length: number, rests: number): number {
  if (at <= rests) return 0;
  return Math.min(at, length - other);
}

/** Which of a Clip's Fades: its fade in or its fade out. */
export type FadeEnd = keyof ClipFades;

/** Whether it names one of a Clip's Fades: its fade in or its fade out. */
export function isFadeEnd(what: string | null): what is FadeEnd {
  return what === 'fadeIn' || what === 'fadeOut';
}

/** A Fade's name, as shown, e.g. "Fade in". */
export function fadeName(end: FadeEnd): string {
  return end === 'fadeIn' ? 'Fade in' : 'Fade out';
}

/**
 * Which Fade's dot a press at x grabs, the dot `pressed` taking it, with
 * the fade-in dot's middle at inAt and the fade-out dot's at outAt, each
 * `width` wide, all in one unit, e.g. pixels or seconds. Where the Fades meet, or the Clip is narrow,
 * the dots sit together, one over the other, so the side of their middle
 * the pointer is on says which, and both can still be grabbed.
 */
export function grabbedFade(pressed: FadeEnd, x: number, inAt: number, outAt: number, width: number): FadeEnd {
  if (outAt - inAt >= width) return pressed;
  return x < (inAt + outAt) / 2 ? 'fadeIn' : 'fadeOut';
}

/** A curve a gain follows: from `at` seconds, for `duration` seconds, through its values. */
export interface FadeCurve {
  at: number;
  duration: number;
  values: Float32Array;
}

/**
 * How a Clip's Fades shape duration seconds of it played from time t: the
 * gain it starts at, and a curve for each Fade it plays, from when it
 * starts, in seconds from t. The curves never overlap.
 */
export function fadeCurves(fades: PlacedFades, t: number, duration: number): { initial: number; curves: FadeCurve[] } {
  const until = t + duration;
  const curves: FadeCurve[] = [];
  const spans = [
    [fades.start, fades.start + fades.fadeIn],
    [fades.end - fades.fadeOut, fades.end],
  ];
  let after = 0;
  for (const [from, to] of spans) {
    const at = Math.max(from - t, 0, after);
    const length = Math.min(to, until) - t - at;
    if (length <= 1e-9) continue;
    const count = Math.max(2, Math.ceil(length * pointsPerSecond) + 1);
    const values = Float32Array.from({ length: count }, (_, i) =>
      fadeGainAt(fades, t + at + (i / (count - 1)) * length),
    );
    curves.push({ at, duration: length, values });
    after = at + length;
  }
  return { initial: fadeGainAt(fades, t), curves };
}

/** A waveform peak, t seconds into a Clip `length` seconds long, as its Fades make it sound. */
export function shapedPeak(peak: number, fades: ClipFades, length: number, t: number): number {
  return peak * fadeGainAt({ ...fades, start: 0, end: length }, t);
}

/** How long a Fade is, as shown, e.g. "1.5 s", to the hundredth of a second. */
export function formatFade(seconds: number): string {
  return `${Math.round(seconds * 100) / 100} s`;
}
