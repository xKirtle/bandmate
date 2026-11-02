import { deviceStorage } from './deviceStorage';
import type { InputChoice } from './inputSettings';
import { input } from './sharedInput.svelte';
import { readTunerInput, storeTunerInput } from './tunerInput';

// The Tuner's Input, held for the session, so it's the same however often
// the Tuner's page is opened, even where it can't be kept.

let picked = $state.raw(readTunerInput(deviceStorage()));

export const tunerInput = {
  /** The Input picked on the Tuner, or null while none is, so it's the Input recorded from. */
  get picked(): InputChoice | null {
    return picked;
  },
  /** The Input the Tuner listens on: the one picked, or until one is, the Input recorded from. */
  get value(): InputChoice {
    return picked ?? input.value;
  },
  /** Picks the Input the Tuner listens on, and keeps it on this device. It never changes the Input recorded from. */
  set(choice: InputChoice) {
    picked = choice;
    storeTunerInput(deviceStorage(), choice);
  },
};
