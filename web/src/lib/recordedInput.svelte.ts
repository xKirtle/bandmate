import type { Calibration } from './calibration';
import { watchInputs, whichInput } from './capture';
import type { InputChoice } from './inputSettings';
import { calibrations } from './sharedCalibration.svelte';

/**
 * The Input recording from a choice would open, as far as can be told
 * without opening it, and its calibration, e.g. to show its Latency
 * Offset: the Input chosen, or the one the default input looks to be. Null
 * while that can't be told, e.g. for the default before the browser allows
 * the microphone. Told again as the choice changes, inputs come and go,
 * and the microphone is allowed. Only looking, it never moves an offset:
 * only opening an Input says for sure which one the default is. Made in a
 * component, it lasts as long as the component.
 */
export class RecordedInput {
  current = $state.raw<InputChoice | null>(null);
  #choice: () => InputChoice;

  constructor(choice: () => InputChoice) {
    this.#choice = choice;
    $effect(() => {
      const chosen = $state.snapshot(choice());
      let live = true;
      // The one chosen, until it's known whether it's connected.
      this.current = chosen.deviceId === '' ? null : chosen;
      const check = async () => {
        const input = await whichInput(chosen);
        if (live) this.current = input;
      };
      void check();
      const unwatch = watchInputs(check);
      return () => {
        live = false;
        unwatch();
      };
    });
  }

  /** Its calibration, as it would apply once opened. */
  get calibration(): Calibration {
    return calibrations.shownFor(this.#choice(), this.current);
  }
}
