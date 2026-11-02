import type { Calibration } from './calibration';
import { connectedDevices, watchInputs, type ConnectedDevice, type InputLevel } from './capture';
import { listInputs, type InputRow } from './inputList';
import { deviceName, type DeviceChannel, type InputChoice } from './inputSettings';
import { RecordedInput } from './recordedInput.svelte';
import { calibrations } from './sharedCalibration.svelte';
import { input } from './sharedInput.svelte';

// The Inputs on this device, as a list of them shows them: first the
// default input, then each channel of each device connected, each to pick;
// then every Input kept whose device isn't. Told again as devices come and
// go, and once the browser allows the microphone. Made while a component
// is set up, as it watches the devices while that's mounted. By default
// they're picked to record from; the Tuner picks its own from them.

/** A connected row: the default input, or a device's channel. */
export interface ConnectedRow {
  /** Tells it from the others while it's listed. */
  key: string;
  /** Its name in full, e.g. "Input 1 · Scarlett 2i2", or "Default input". */
  name: string;
  /** Its channel and device, to show the channel first and cut the device short; null for the default input. */
  channel: DeviceChannel | null;
  /** The Input the default input looks to be, to show under its name; null for any other. */
  is: DeviceChannel | null;
  calibration: Calibration;
  /** The Input to choose, meter and calibrate, as chosen. */
  input: InputChoice;
  /** Whether it's calibrated as that Input exactly, rather than as the Input it turns out to be. */
  exact: boolean;
  /** Whether it's the Input used: the one picked, or the one used in its place where that isn't connected. */
  chosen: boolean;
}

const defaultInput: InputChoice = { deviceId: '', label: '', channel: 0 };
/** Tells an Input from the others listed: its device and channel. */
export const keyOf = (input: InputChoice) => JSON.stringify([input.deviceId, input.channel]);

/** Which Input the rows pick, and what's used in its place where it isn't connected. */
export interface PickedInput {
  /** The Input picked. */
  value: () => InputChoice;
  /** Picks one. */
  set: (choice: InputChoice) => void;
  /** The Input used where the one picked isn't connected: the default input unless it's another. */
  instead?: () => InputChoice;
}

/** The Input recorded from, chosen on this device, in this tab or another. */
const recordedFrom: PickedInput = { value: () => input.value, set: (choice) => input.set(choice) };

export class InputRows {
  #picked: PickedInput = recordedFrom;
  // The Input picked.
  #choice = $derived(this.#picked.value());
  // The Input used in its place where it isn't connected.
  #instead = $derived(this.#picked.instead?.() ?? defaultInput);
  // The Input used: the one picked, or where it isn't connected, the one
  // instead, or where that isn't either, the default.
  #used = $derived(
    this.#connected(this.#choice) ? this.#choice : this.#connected(this.#instead) ? this.#instead : defaultInput,
  );
  // The default input, as chosen where it is, e.g. a channel of it chosen before Inputs were listed.
  #defaultChoice = $derived(this.#used.deviceId === '' ? this.#used : defaultInput);
  // The Input the default input looks to be, and its calibration.
  #defaultRecorded = new RecordedInput(() => this.#defaultChoice);

  // The audio devices connected, with how many channels each is known to
  // have; null while which they are can't be told.
  #devices = $state.raw<ConnectedDevice[] | null>(null);
  // Whether which they are has been asked yet, so the microphone is taken as allowed till then.
  #told = $state(false);
  // How many channels a device turned out to have once opened, where the browser didn't say before.
  #learned = $state<Record<string, number>>({});
  #listed = $derived(
    listInputs(
      this.#devices?.map((d) => ({ ...d, channels: Math.max(d.channels, this.#learned[d.deviceId] ?? 0) })) ?? null,
      calibrations.kept,
      this.#choice,
    ),
  );

  constructor(picked: PickedInput = recordedFrom) {
    this.#picked = picked;
    $effect(() => {
      let live = true;
      const check = async () => {
        const found = await connectedDevices();
        if (!live) return;
        this.#devices = found;
        this.#told = true;
      };
      void check();
      const unwatch = watchInputs(check);
      return () => {
        live = false;
        unwatch();
      };
    });
  }

  /**
   * Whether the browser says which inputs are connected, by name, as it
   * does once the microphone is allowed: till then, opening one asks for
   * it. Taken as allowed until the browser has been asked.
   */
  readonly microphoneAllowed = $derived(this.#devices !== null || !this.#told);

  /** The device picked when it isn't connected, so another is used in its place; null otherwise. */
  readonly chosenGone = $derived(this.#connected(this.#choice) ? null : deviceName(this.#choice.label));

  /** Whether an Input's device is connected, as far as can be told: the default input always is. */
  #connected(choice: InputChoice): boolean {
    return (
      choice.deviceId === '' || this.#devices === null || this.#devices.some((d) => d.deviceId === choice.deviceId)
    );
  }

  /** The default input, then each channel of each device connected. */
  readonly connected: ConnectedRow[] = $derived([
    {
      key: 'default',
      name: 'Default input',
      channel: null,
      is: this.#defaultRecorded.current,
      calibration: this.#defaultRecorded.calibration,
      input: this.#defaultChoice,
      exact: false,
      chosen: this.#used.deviceId === '',
    },
    ...this.#listed.connected.map((row) => ({
      key: keyOf(row.input),
      name: row.name,
      channel: row.input,
      is: null,
      calibration: row.calibration,
      input: row.input,
      exact: true,
      chosen: keyOf(row.input) === keyOf(this.#used),
    })),
  ]);

  /** Every Input kept whose device isn't connected, to forget. */
  get notConnected(): InputRow[] {
    return this.#listed.notConnected;
  }

  /** Picks a row's Input: by default, the one recorded from on this device. */
  choose(row: ConnectedRow) {
    this.#picked.set(row.exact ? $state.snapshot(row.input) : defaultInput);
  }

  /** Learns how many channels a device has from an opening of it, e.g. a level meter's. */
  learn(level: InputLevel | null) {
    const deviceId = level?.opened?.deviceId;
    if (level && deviceId) this.#learned[deviceId] = Math.max(this.#learned[deviceId] ?? 0, level.channels);
  }
}
