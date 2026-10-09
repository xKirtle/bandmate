// The input a recording captures: a device, and one channel of it, since
// Takes are mono and an interface usually has two inputs. It's chosen in
// Settings, or with the Timeline's mic button, and kept on this device,
// like its Latency Offset, since it belongs to the hardware here, not to
// any Song.
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/** The input chosen: a device, by id ('' for the default), and a channel of it, from 0. */
export interface InputChoice {
  deviceId: string;
  /** The device's label when chosen, to say which one is gone. */
  label: string;
  channel: number;
}

/** Where the input chosen is kept on this device. */
export const inputKey = 'bandmate.input';

const defaultInput: InputChoice = { deviceId: '', label: '', channel: 0 };

/** The input chosen on this device, or the default input's first channel. */
export function readInput(storage: Storage | undefined): InputChoice {
  try {
    const kept = JSON.parse(storage?.getItem(inputKey) ?? 'null');
    const { deviceId, label, channel } = kept ?? {};
    if (typeof deviceId !== 'string' || !Number.isInteger(channel) || channel < 0) return { ...defaultInput };
    return { deviceId, label: typeof label === 'string' ? label : '', channel };
  } catch {
    return { ...defaultInput };
  }
}

/** Keeps the input chosen on this device. */
export function storeInput(storage: Storage | undefined, choice: InputChoice) {
  try {
    storage?.setItem(inputKey, JSON.stringify(choice));
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}

/** The Input, as a Device Setting is kept on this device. */
export const inputSetting = {
  key: inputKey,
  read: readInput,
  store: storeInput,
} satisfies DeviceSettingStorage<InputChoice>;

/** Whether two choices are the same Input: the same device and channel, whatever their labels. */
export function sameInput(a: InputChoice, b: InputChoice): boolean {
  return a.deviceId === b.deviceId && a.channel === b.channel;
}

/** The input to open: the one chosen, or where it can't be, the default's first channel. */
export interface ResolvedInput {
  deviceId: string;
  channel: number;
  /** The name of the device chosen when it isn't connected, to say so; null otherwise. */
  gone: string | null;
}

/**
 * The input to record from, among the inputs connected: the one chosen,
 * or the default when it's gone. Given how many channels the device has,
 * a channel it doesn't have falls back to the first.
 */
export function resolveInput(
  devices: readonly { deviceId: string }[],
  choice: InputChoice,
  channels: number,
): ResolvedInput {
  if (choice.deviceId !== '' && !devices.some((d) => d.deviceId === choice.deviceId)) {
    return { deviceId: '', channel: 0, gone: deviceName(choice.label) };
  }
  const channel = choice.channel >= channels ? 0 : choice.channel;
  return { deviceId: choice.deviceId, channel, gone: null };
}

/** An audio input as the browser lists it. */
export interface ListedInput {
  deviceId: string;
  groupId: string;
  label: string;
}

/** The browser's own stand-ins for the default input, which Chrome lists beside the device it is. */
export const standIns = ['default', 'communications'];

/**
 * The Input a choice records from, among the inputs the browser lists: the
 * Input chosen while its device is connected, or else that channel of the
 * device the default input is (Input 1, where the one chosen is gone).
 * Opened is what the browser says an input opened as the default came from.
 * Null where it can't tell which device the default is, e.g. before the
 * browser allows the microphone, as it lists no ids till then.
 */
export function inputRecorded(
  listed: readonly ListedInput[],
  choice: InputChoice,
  opened: { deviceId?: string; groupId?: string } = {},
): InputChoice | null {
  const devices = listed.filter((d) => d.deviceId !== '' && !standIns.includes(d.deviceId));
  const at = (device: ListedInput | undefined, channel: number) =>
    device ? { deviceId: device.deviceId, label: device.label, channel } : null;
  if (choice.deviceId !== '') {
    if (devices.length === 0) return choice;
    const chosen = devices.find((d) => d.deviceId === choice.deviceId);
    if (chosen) return at(chosen, choice.channel);
  }
  const channel = choice.deviceId === '' ? choice.channel : 0;
  // Firefox and Safari say which device opened, and list the default first;
  // Chrome says "default", with the group its stand-in shares with the device.
  const group = opened.groupId || listed.find((d) => d.deviceId === 'default')?.groupId;
  return at(
    devices.find((d) => d.deviceId === opened.deviceId) ??
      (group ? devices.find((d) => d.groupId === group) : undefined) ??
      devices[0],
    channel,
  );
}

/** A device's name to show: its label, without the USB ids some browsers add. */
export function deviceName(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || 'Unnamed input';
}

/**
 * A channel's name to show, e.g. "Input 1 · Scarlett 2i2": the channel
 * leads, as it's what tells a device's Inputs apart where a long device
 * name is cut short.
 */
export function channelName(label: string, channel: number): string {
  return `${channelNumber(channel)} · ${deviceName(label)}`;
}

/** A channel of a device, as it leads its name, e.g. "Input 1": counted from 1. */
export function channelNumber(channel: number): string {
  return `Input ${channel + 1}`;
}

/** Orders Inputs by their device's name, then each device's by channel. */
export function byDeviceThenChannel(a: { label: string; channel: number }, b: { label: string; channel: number }) {
  return deviceName(a.label).localeCompare(deviceName(b.label)) || a.channel - b.channel;
}

/**
 * The Input chosen, to show without opening it: by the label it had when
 * chosen, and its channel, or "Default input" while none is chosen.
 */
export function inputName(choice: InputChoice): string {
  if (choice.deviceId === '' && choice.channel === 0) return 'Default input';
  return channelName(choice.deviceId === '' ? 'Default input' : choice.label, choice.channel);
}

// The meter's range, in dB below full scale.
const floor = -60;
// At or past this, an input has clipped: interfaces clip just short of 1.
const clipAt = 0.999;

/**
 * How full the level meter is for a block of samples, from 0 to 1 over
 * -60 to 0 dB of its peak, and whether the block clipped.
 */
export function meterLevel(samples: Float32Array): { fill: number; clipped: boolean } {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const fill = Math.min(1, Math.max(0, (db - floor) / -floor));
  return { fill, clipped: peak >= clipAt };
}
