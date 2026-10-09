import { describe, expect, it } from 'vitest';
import { listInputs, statusOf } from './inputList';

const scarlett = { deviceId: 'scarlett', label: 'Scarlett 2i2 USB (1235:8210)', channels: 2 };
const laptop = { deviceId: 'laptop', label: 'Built-in Microphone', channels: 1 };
const fresh = { offset: null, offered: false };

describe('listInputs', () => {
  it("lists every channel of every Input connected, in the browser's order, uncalibrated until kept", () => {
    const { connected, notConnected } = listInputs([scarlett, laptop], []);

    expect(connected.map((row) => row.name)).toEqual([
      'Scarlett 2i2 USB · Input 1',
      'Scarlett 2i2 USB · Input 2',
      'Built-in Microphone · Input 1',
    ]);
    expect(connected[1].input).toEqual({ deviceId: 'scarlett', label: scarlett.label, channel: 1 });
    expect(connected.map((row) => row.calibration)).toEqual([fresh, fresh, fresh]);
    expect(notConnected).toEqual([]);
  });

  it('gives each connected Input its own calibration, skipped or calibrated', () => {
    const { connected } = listInputs(
      [scarlett, laptop],
      [
        { deviceId: 'scarlett', label: scarlett.label, channel: 1, offset: 0.021, offered: true },
        { deviceId: 'laptop', label: laptop.label, channel: 0, offset: null, offered: true },
      ],
    );

    expect(connected.map((row) => statusOf(row.calibration))).toEqual(['Not calibrated', '21 ms', 'Skipped']);
  });

  it('lists a channel kept for a device beyond the channels it is known to have', () => {
    const { connected } = listInputs(
      [laptop],
      [{ deviceId: 'laptop', label: laptop.label, channel: 2, offset: 0.03, offered: true }],
    );

    expect(connected.map((row) => row.name)).toEqual([
      'Built-in Microphone · Input 1',
      'Built-in Microphone · Input 2',
      'Built-in Microphone · Input 3',
    ]);
    expect(statusOf(connected[2].calibration)).toBe('30 ms');
  });

  it('lists every Input kept whose device is not connected, by name, apart from the connected', () => {
    const { connected, notConnected } = listInputs(
      [laptop],
      [
        { deviceId: 'yeti', label: 'Blue Yeti', channel: 0, offset: null, offered: true },
        { deviceId: 'scarlett', label: scarlett.label, channel: 1, offset: 0.045, offered: true },
        { deviceId: 'laptop', label: laptop.label, channel: 0, offset: 0.012, offered: true },
      ],
    );

    expect(connected.map((row) => row.name)).toEqual(['Built-in Microphone · Input 1']);
    expect(notConnected.map((row) => [row.name, statusOf(row.calibration)])).toEqual([
      ['Blue Yeti · Input 1', 'Skipped'],
      ['Scarlett 2i2 USB · Input 2', '45 ms'],
    ]);
    expect(notConnected[1].input).toEqual({ deviceId: 'scarlett', label: scarlett.label, channel: 1 });
  });

  it("lists every Input kept as connected while it can't be told which are", () => {
    const { connected, notConnected } = listInputs(null, [
      { deviceId: 'scarlett', label: scarlett.label, channel: 1, offset: 0.045, offered: true },
    ]);

    expect(connected.map((row) => row.name)).toEqual(['Scarlett 2i2 USB · Input 2']);
    expect(notConnected).toEqual([]);
  });

  it("lists the Input chosen while it can't be told which are connected, kept or not", () => {
    const chosen = { deviceId: 'laptop', label: laptop.label, channel: 0 };
    const kept = [{ deviceId: 'scarlett', label: scarlett.label, channel: 1, offset: 0.045, offered: true }];

    expect(listInputs(null, kept, chosen).connected.map((row) => row.name)).toEqual([
      'Built-in Microphone · Input 1',
      'Scarlett 2i2 USB · Input 2',
    ]);
    expect(listInputs(null, [], { deviceId: '', label: '', channel: 0 }).connected).toEqual([]);
    expect(listInputs([scarlett], [], chosen).notConnected).toEqual([]);
  });
});
