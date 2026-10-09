// Where calibration's metronome is drawn: an arm swinging upright as each
// click is heard, and a mark on its arc for each tap, placed by its delay
// from the average. Angles are in degrees from upright, clockwise.
import { clickEvery, clickTime } from './calibration';

/** How far either side of upright the arc reaches, and the arm swings, in degrees. */
export const arcReach = 38;
// A tap's delay from the average is magnified so that ±60 ms spans the
// arc, in degrees per second: one further off stays at its end.
const magnified = arcReach / 0.06;
/** How long a tap's mark shows as it fades, in seconds. */
export const markFor = 4;

/**
 * How many clicks have been heard, at a context time as heard, since the
 * first, with clicks scheduled from a context time: a whole number as each
 * is heard, below 0 before the first.
 */
export function beatAt(heard: number, from: number): number {
  return (heard - from - clickTime(0)) / clickEvery;
}

/** The arm's angle at a beat: upright as each click is heard, to one side, then the other, between them. */
export function armAngle(beat: number): number {
  return Math.sin(Math.PI * beat) * arcReach;
}

/** Where a tap's mark sits on the arc: by its delay from the average, later to the right, kept on the arc. */
export function markAngle(delay: number, average: number): number {
  return Math.max(-arcReach, Math.min(arcReach, (delay - average) * magnified));
}

/** How much of a tap's mark shows, from 1 as it's heard to 0 once it's faded, seconds after. */
export function markFade(age: number): number {
  return Math.max(0, 1 - age / markFor);
}
