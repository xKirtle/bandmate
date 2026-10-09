// The Latency Offset of each Input, kept on this device: an Input is
// calibrated once, and switching Inputs picks up its offset. It belongs to
// the hardware here, never to any Song, so it's never on the server or in
// a Backup. An Input is kept by its device's id and channel, with the
// device's label when calibrated, to name it while it isn't connected; an
// unplugged one keeps its offset until it's forgotten. The default input
// never has one of its own: its offset is that of the Input it turns out
// to be when it's opened.
//
// Before offsets were kept per Input there was one, for the whole device.
// It moves to the Input chosen then, the first time these are read; with
// the default input chosen, to the Input the default turns out to be.
import type { Calibration } from './calibration';
import { DeviceSetting, type DeviceSettingStorage } from './deviceSetting.svelte';
import { channelName, inputKey, readInput, type InputChoice } from './inputSettings';

/** An Input, by its device's id and channel, as its calibration is kept. */
export type InputId = Pick<InputChoice, 'deviceId' | 'channel'>;

/** An Input's calibration, with the device's label when it was kept. */
export type InputCalibration = InputChoice & Calibration;

/** An Input with a Latency Offset. */
export type CalibratedInput = InputCalibration & { offset: number };

/** Every Input's calibration kept on this device. */
interface Calibrations {
  inputs: InputCalibration[];
  /** The one offset kept before, waiting for the default input, chosen then, to turn out to be an Input. */
  unclaimed: Calibration | null;
}

/** Where they're kept on this device. */
export const calibrationsKey = 'bandmate.latencyOffsets';
/** Where the one offset was kept before. */
const formerKey = 'bandmate.latency';

const uncalibrated: Calibration = { offset: null, offered: false };

/** A calibration as it was kept, or the uncalibrated one where it can't be read. */
function readOne(kept: unknown): Calibration {
  const { offset, offered } = (kept ?? {}) as Record<string, unknown>;
  return {
    offset: typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 ? offset : null,
    offered: offered === true,
  };
}

function readCalibrations(storage: Storage | undefined): Calibrations {
  try {
    const kept = storage?.getItem(calibrationsKey);
    if (kept == null) return moveFormer(storage);
    const { inputs, unclaimed } = JSON.parse(kept) ?? {};
    return {
      inputs: (Array.isArray(inputs) ? inputs : [])
        .filter((i) => typeof i?.deviceId === 'string' && i.deviceId !== '' && Number.isInteger(i.channel))
        .map((i) => ({
          deviceId: i.deviceId,
          label: typeof i.label === 'string' ? i.label : '',
          channel: i.channel,
          ...readOne(i),
        })),
      unclaimed: unclaimed ? readOne(unclaimed) : null,
    };
  } catch {
    return { inputs: [], unclaimed: null };
  }
}

/** The one offset kept before, moved to the Input chosen, and kept so. */
function moveFormer(storage: Storage | undefined): Calibrations {
  const former = storage?.getItem(formerKey);
  if (former == null) return { inputs: [], unclaimed: null };
  let calibration = uncalibrated;
  try {
    calibration = readOne(JSON.parse(former));
  } catch {
    // Unreadable, so moved as uncalibrated.
  }
  const chosen = storage?.getItem(inputKey) == null ? null : readInput(storage);
  const moved: Calibrations =
    chosen && chosen.deviceId !== ''
      ? { inputs: [{ ...chosen, ...calibration }], unclaimed: null }
      : { inputs: [], unclaimed: calibration };
  storeCalibrations(storage, moved);
  storage?.removeItem(formerKey);
  return moved;
}

function storeCalibrations(storage: Storage | undefined, calibrations: Calibrations) {
  try {
    storage?.setItem(calibrationsKey, JSON.stringify(calibrations));
  } catch {
    // Not kept, e.g. in a private window; they still apply until reload.
  }
}

const calibrationsSetting = {
  key: calibrationsKey,
  read: readCalibrations,
  store: storeCalibrations,
} satisfies DeviceSettingStorage<Calibrations>;

const same = (a: InputId, b: InputId) => a.deviceId === b.deviceId && a.channel === b.channel;

/**
 * Every Input's Latency Offset on this device, and whether calibration was
 * offered for it, shared by every part of the page, and by this device's
 * tabs: one calibrated or skipped in any of them places the next Take from
 * that Input, or isn't offered again, in all of them.
 */
export class InputCalibrations {
  #setting: DeviceSetting<Calibrations>;

  /** `tabs` tells of other tabs' changes to storage: the window, in the app. */
  constructor(storage: Storage | undefined, tabs: EventTarget) {
    this.#setting = new DeviceSetting(calibrationsSetting, storage, tabs);
  }

  /**
   * An Input's calibration: uncalibrated and not yet offered until it's
   * calibrated or skipped. Null is the default input while it isn't known
   * which Input it is.
   */
  of(input: InputId | null): Calibration {
    const { inputs, unclaimed } = this.#setting.value;
    if (input === null) return unclaimed ?? uncalibrated;
    const kept = inputs.find((i) => same(i, input));
    return kept ? { offset: kept.offset, offered: kept.offered } : uncalibrated;
  }

  /** Keeps an Input's calibration: an offset measured, or calibration skipped. */
  set(input: InputChoice, calibration: Calibration) {
    const { inputs, unclaimed } = this.#setting.value;
    const { deviceId, label, channel } = input;
    this.#setting.set({
      inputs: [...inputs.filter((i) => !same(i, input)), { deviceId, label, channel, ...calibration }],
      unclaimed,
    });
  }

  /**
   * Every Input with a Latency Offset on this device, connected or not, by
   * name, each with the label its device had when calibrated: those only
   * skipped have none to list.
   */
  get calibrated(): CalibratedInput[] {
    return this.#setting.value.inputs
      .filter((i): i is CalibratedInput => i.offset !== null)
      .sort((a, b) => channelName(a.label, a.channel).localeCompare(channelName(b.label, b.channel)));
  }

  /** Forgets an Input's offset, so it's uncalibrated, and calibration is offered before its next recording. */
  forget(input: InputId) {
    const { inputs, unclaimed } = this.#setting.value;
    const others = inputs.filter((i) => !same(i, input));
    // While the one offset kept before waits for the default input, the
    // Input stays, uncalibrated, so it can't take that one in its place.
    const kept = unclaimed ? inputs.filter((i) => same(i, input)).map((i) => ({ ...i, ...uncalibrated })) : [];
    this.#setting.set({ inputs: [...others, ...kept], unclaimed });
  }

  /**
   * The calibration to show for a choice, given the Input it looks to
   * record from, if that can be told, without opening it: with the default
   * chosen, an Input without one of its own shows the one offset kept
   * before, which it will have if it turns out to be the default once
   * opened.
   */
  shownFor(choice: InputChoice, input: InputId | null): Calibration {
    const { inputs } = this.#setting.value;
    if (choice.deviceId !== '') return this.of(input);
    return input && inputs.some((i) => same(i, input)) ? this.of(input) : this.of(null);
  }

  /**
   * Says which Input was opened for a choice. With the default chosen, the
   * one offset kept before moves to it, unless it has its own.
   */
  opened(choice: InputChoice, input: InputChoice) {
    const { inputs, unclaimed } = this.#setting.value;
    if (choice.deviceId !== '' || !unclaimed) return;
    const own = inputs.some((i) => same(i, input));
    const { deviceId, label, channel } = input;
    this.#setting.set({
      inputs: own ? inputs : [...inputs, { deviceId, label, channel, ...unclaimed }],
      unclaimed: null,
    });
  }
}
