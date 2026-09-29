// The input a recording captures: a device, and one channel of it, since
// Takes are mono and an interface usually has two inputs. It's chosen in
// the recording settings and kept on this device, like its Latency Offset,
// since it belongs to the hardware here, not to any Song.

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

/** A device's name to show: its label, without the USB ids some browsers add. */
export function deviceName(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || 'Unnamed input';
}

/** A channel's name to show, e.g. "Scarlett 2i2 · Input 1". */
export function channelName(label: string, channel: number): string {
  return `${deviceName(label)} · Input ${channel + 1}`;
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
