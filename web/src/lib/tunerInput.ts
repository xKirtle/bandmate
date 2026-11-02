// The Tuner's Input (see the glossary's Tuner): the one it listens on, its
// own, picked on the Tuner's page, so a guitar on Input 2 can be tuned while
// vocals still record from Input 1. Until one is picked there it's the Input
// recorded from; the last one picked is kept on this device. It's
// remembered, not a Device Setting (ADR 0017), and kept apart from the Input
// recorded from, which picking it never changes.

import type { InputChoice } from './inputSettings';

/** Where the Tuner's Input is kept on this device. */
export const tunerInputKey = 'bandmate.tuner.input';

/** The Input last picked on the Tuner on this device, or null where none is, so it's the Input recorded from. */
export function readTunerInput(storage: Storage | undefined): InputChoice | null {
  try {
    const kept = JSON.parse(storage?.getItem(tunerInputKey) ?? 'null');
    const { deviceId, label, channel } = kept ?? {};
    if (typeof deviceId !== 'string' || !Number.isInteger(channel) || channel < 0) return null;
    return { deviceId, label: typeof label === 'string' ? label : '', channel };
  } catch {
    return null;
  }
}

/** Keeps the Input picked on the Tuner on this device. */
export function storeTunerInput(storage: Storage | undefined, choice: InputChoice) {
  try {
    storage?.setItem(tunerInputKey, JSON.stringify(choice));
  } catch {
    // Not kept, e.g. in a private window; the pick still applies until reload.
  }
}
