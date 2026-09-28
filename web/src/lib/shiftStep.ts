// How far the Lyric Sheet's Shift Cues controls move every Cue per click.
// The last step chosen is remembered on this device: a convenience, not
// part of the Song.

/** The steps offered, in seconds. None is below a tenth, as the Cue field shows tenths. */
export const shiftSteps = [1, 0.5, 0.1] as const;

/** A step offered, in seconds. */
export type ShiftStep = (typeof shiftSteps)[number];

/** The step until one's chosen. */
export const defaultShiftStep: ShiftStep = 0.1;

/** Where the chosen step is kept on this device. */
export const shiftStepKey = 'bandmate.cueShiftStep';

/** The step chosen on this device, or the default if none is, or it can't be read. */
export function readShiftStep(storage: Storage | undefined): ShiftStep {
  try {
    const kept = Number(storage?.getItem(shiftStepKey) || NaN);
    return shiftSteps.find((s) => s === kept) ?? defaultShiftStep;
  } catch {
    return defaultShiftStep;
  }
}

/** Keeps the chosen step on this device. */
export function storeShiftStep(storage: Storage | undefined, step: ShiftStep) {
  try {
    storage?.setItem(shiftStepKey, String(step));
  } catch {
    // Not kept, e.g. in a private window; the step still applies until reload.
  }
}
