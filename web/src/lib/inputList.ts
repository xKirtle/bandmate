// The Input list: every Input on this device, to choose the one recorded
// from and to calibrate any of them. Each channel of a device connected is
// an Input of its own; then come the Inputs kept, with a Latency Offset or
// skipped, whose device isn't connected, to forget.
import { formatOffset, type Calibration } from './calibration';
import type { InputCalibration } from './inputCalibrations';
import type { ConnectedDevice } from './capture';
import { byDeviceThenChannel, channelName, sameInput, type InputChoice } from './inputSettings';

/** An Input listed, with its name to show and its calibration. */
export interface InputRow {
  input: InputChoice;
  name: string;
  calibration: Calibration;
}

const uncalibrated: Calibration = { offset: null, offered: false };

/**
 * Every Input connected, each channel of each device in the browser's
 * order, then every Input kept whose device isn't, by device then channel. A device has
 * at least as many channels as any of its Inputs kept. Where it can't be
 * told which devices are connected (null), e.g. before the browser allows
 * the microphone, the Inputs kept are listed as connected, and the one
 * chosen with them, so it's listed whether or not it's kept.
 */
export function listInputs(
  devices: readonly ConnectedDevice[] | null,
  kept: readonly InputCalibration[],
  chosen: InputChoice | null = null,
): { connected: InputRow[]; notConnected: InputRow[] } {
  const row = (input: InputChoice): InputRow => {
    const found = kept.find((k) => sameInput(k, input));
    return {
      input,
      name: channelName(input.label, input.channel),
      calibration: found ? { offset: found.offset, offered: found.offered } : uncalibrated,
    };
  };
  const keptRow = ({ deviceId, label, channel }: InputCalibration) => row({ deviceId, label, channel });
  const byDevice = (a: InputRow, b: InputRow) => byDeviceThenChannel(a.input, b.input);
  if (devices === null) {
    const unkept = chosen && chosen.deviceId !== '' && !kept.some((k) => sameInput(k, chosen)) ? [row(chosen)] : [];
    return { connected: [...kept.map(keptRow), ...unkept].sort(byDevice), notConnected: [] };
  }

  const connected = devices.flatMap(({ deviceId, label, channels }) => {
    const known = Math.max(channels, ...kept.filter((k) => k.deviceId === deviceId).map((k) => k.channel + 1));
    return Array.from({ length: Math.max(1, known) }, (_, channel) => row({ deviceId, label, channel }));
  });
  const notConnected = kept
    .filter((k) => !devices.some((d) => d.deviceId === k.deviceId))
    .map(keptRow)
    .sort(byDevice);
  return { connected, notConnected };
}

/** An Input's status to show at a glance: "21 ms", "Skipped", or "Not calibrated". */
export function statusOf(calibration: Calibration): string {
  if (calibration.offset !== null) return formatOffset(calibration.offset);
  return calibration.offered ? 'Skipped' : 'Not calibrated';
}
