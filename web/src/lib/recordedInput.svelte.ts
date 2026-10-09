import { whichInput } from './capture';
import type { InputChoice } from './inputSettings';
import { calibrations } from './sharedCalibration.svelte';

/**
 * The Input recording from a choice would open, as far as can be told
 * without opening it, e.g. to show its Latency Offset: the Input chosen,
 * or the one the default input is. Null while that can't be told, e.g. for
 * the default before the browser allows the microphone. Told again as the
 * choice changes, inputs come and go, and the microphone is allowed. Made
 * in a component, it lasts as long as the component.
 */
export class RecordedInput {
  current = $state.raw<InputChoice | null>(null);

  constructor(choice: () => InputChoice) {
    $effect(() => {
      const chosen = $state.snapshot(choice());
      let live = true;
      // The one chosen, until it's known whether it's connected.
      this.current = chosen.deviceId === '' ? null : chosen;
      const check = async () => {
        const input = await whichInput(chosen);
        if (!live) return;
        this.current = input;
        if (input && chosen.deviceId === '') calibrations.defaultIs(input);
      };
      void check();
      const devices = navigator.mediaDevices;
      devices?.addEventListener('devicechange', check);
      let permission: PermissionStatus | undefined;
      navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (!live) return;
          permission = status;
          status.addEventListener('change', check);
        })
        .catch(() => {});
      return () => {
        live = false;
        devices?.removeEventListener('devicechange', check);
        permission?.removeEventListener('change', check);
      };
    });
  }
}
