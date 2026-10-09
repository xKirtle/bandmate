import { describe, expect, it } from 'vitest';
import { InputCalibrations } from './inputCalibrations';

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

/** The calibrations as the app keeps them, in a stand-in Storage this device's other tabs share. */
function setup(values: Record<string, string> = {}, blocked = false) {
  const tabs = new EventTarget();
  const calibrations = new InputCalibrations(storage(values, blocked), tabs);
  /** Another tab keeps a value, or clears storage with a null key, as the browser tells this one. */
  const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
  /** The same storage, as another tab, or this one after a reload, reads it. */
  const reloaded = () => new InputCalibrations(storage(values, blocked), new EventTarget());
  return { calibrations, values, otherTab, reloaded };
}

const fresh = { offset: null, offered: false };
const mic = { deviceId: 'mic', label: 'Scarlett Solo USB', channel: 0 };
const guitar = { deviceId: 'mic', label: 'Scarlett Solo USB', channel: 1 };
const laptop = { deviceId: 'laptop', label: 'Built-in Microphone', channel: 0 };
const defaultChoice = { deviceId: '', label: '', channel: 0 };

describe('InputCalibrations', () => {
  it('is uncalibrated and not yet offered for every Input on a new device', () => {
    const { calibrations } = setup();
    expect(calibrations.of(mic)).toEqual(fresh);
    expect(calibrations.of(null)).toEqual(fresh);
  });

  it("keeps each Input's own offset, two channels of one device apart", () => {
    const { calibrations, reloaded } = setup();
    calibrations.set(mic, { offset: 0.021, offered: true });
    calibrations.set(guitar, { offset: 0.034, offered: true });

    expect(calibrations.of(mic)).toEqual({ offset: 0.021, offered: true });
    expect(calibrations.of(guitar)).toEqual({ offset: 0.034, offered: true });
    expect(calibrations.of(laptop)).toEqual(fresh);
    expect(reloaded().of(guitar)).toEqual({ offset: 0.034, offered: true });
  });

  it('remembers calibration skipped for one Input, still uncalibrated, and offers it for the others', () => {
    const { calibrations, reloaded } = setup();
    calibrations.set(mic, { offset: null, offered: true });

    expect(reloaded().of(mic)).toEqual({ offset: null, offered: true });
    expect(reloaded().of(guitar)).toEqual(fresh);
  });

  it('recalibrating an Input replaces its offset, whatever its label now', () => {
    const { calibrations } = setup();
    calibrations.set(mic, { offset: 0.021, offered: true });
    calibrations.set({ ...mic, label: 'Scarlett Solo' }, { offset: 0.025, offered: true });
    expect(calibrations.of(mic)).toEqual({ offset: 0.025, offered: true });
  });

  it("keeps an Input's offset while its device isn't connected, by its id", () => {
    const { calibrations, reloaded } = setup();
    calibrations.set(mic, { offset: 0.021, offered: true });
    // Nothing forgets it but forgetting it: unplugging doesn't touch storage.
    expect(reloaded().of({ deviceId: 'mic', channel: 0 })).toEqual({ offset: 0.021, offered: true });
  });

  it('lists every Input with an offset by name, with the label it was calibrated with, but none only skipped', () => {
    const { calibrations, reloaded } = setup();
    calibrations.set(guitar, { offset: 0.034, offered: true });
    calibrations.set(laptop, { offset: null, offered: true });
    calibrations.set(mic, { offset: 0.021, offered: true });
    const usb = { deviceId: 'usb', label: 'Blue Yeti', channel: 0 };
    calibrations.set(usb, { offset: 0.012, offered: true });
    // Recalibrated, it stays where it was in the list.
    calibrations.set(guitar, { offset: 0.03, offered: true });

    const listed = [
      { ...usb, offset: 0.012, offered: true },
      { ...mic, offset: 0.021, offered: true },
      { ...guitar, offset: 0.03, offered: true },
    ];
    expect(calibrations.calibrated).toEqual(listed);
    expect(reloaded().calibrated).toEqual(listed);
  });

  it('forgets an Input, so it is uncalibrated and offered again, keeping the others', () => {
    const { calibrations, reloaded } = setup();
    calibrations.set(mic, { offset: 0.021, offered: true });
    calibrations.set(guitar, { offset: 0.034, offered: true });
    calibrations.forget({ deviceId: 'mic', channel: 0 });

    expect(calibrations.of(mic)).toEqual(fresh);
    expect(calibrations.of(guitar)).toEqual({ offset: 0.034, offered: true });
    expect(reloaded().of(mic)).toEqual(fresh);
    expect(reloaded().calibrated).toEqual([{ ...guitar, offset: 0.034, offered: true }]);
  });

  it('gives the offset of the Input the default input is, once known, never one kept for "default"', () => {
    const { calibrations } = setup();
    calibrations.set(mic, { offset: 0.021, offered: true });
    calibrations.opened(defaultChoice, laptop);
    expect(calibrations.of(laptop)).toEqual(fresh);
    expect(calibrations.of(mic)).toEqual({ offset: 0.021, offered: true });
  });

  describe("moving the one offset kept before, today's, to the Input chosen now", () => {
    const before = (offset: number | null, offered: boolean, chosen?: object) => ({
      'bandmate.latency': JSON.stringify({ offset, offered }),
      ...(chosen && { 'bandmate.input': JSON.stringify(chosen) }),
    });

    it('gives it to the Input chosen, and to no other', () => {
      const { calibrations, values } = setup(before(0.021, true, guitar));
      expect(calibrations.of(guitar)).toEqual({ offset: 0.021, offered: true });
      expect(calibrations.of(mic)).toEqual(fresh);
      expect(calibrations.of(laptop)).toEqual(fresh);
      expect(values['bandmate.latency']).toBeUndefined();
    });

    it('moves calibration skipped the same way', () => {
      const { calibrations } = setup(before(null, true, mic));
      expect(calibrations.of(mic)).toEqual({ offset: null, offered: true });
      expect(calibrations.of(guitar)).toEqual(fresh);
    });

    it('gives it, with the default input chosen, to the Input the default turns out to be, and keeps it so', () => {
      const { calibrations, reloaded } = setup(before(0.021, true));
      // Until then, it's the default's.
      expect(calibrations.of(null)).toEqual({ offset: 0.021, offered: true });
      expect(reloaded().of(null)).toEqual({ offset: 0.021, offered: true });

      calibrations.opened(defaultChoice, laptop);
      expect(calibrations.of(laptop)).toEqual({ offset: 0.021, offered: true });
      expect(calibrations.of(null)).toEqual(fresh);

      // Once given, the default turning out to be another Input moves it no more.
      calibrations.opened(defaultChoice, mic);
      expect(calibrations.of(mic)).toEqual(fresh);
      expect(reloaded().of(laptop)).toEqual({ offset: 0.021, offered: true });
    });

    it('never replaces an offset the Input the default turns out to be has of its own', () => {
      const { calibrations } = setup(before(0.021, true));
      calibrations.set(laptop, { offset: 0.04, offered: true });
      calibrations.opened(defaultChoice, laptop);
      expect(calibrations.of(laptop)).toEqual({ offset: 0.04, offered: true });
    });

    it('keeps it for the default while an Input chosen is opened', () => {
      const { calibrations } = setup(before(0.021, true));
      calibrations.opened(mic, mic);
      expect(calibrations.of(mic)).toEqual(fresh);
      expect(calibrations.of(null)).toEqual({ offset: 0.021, offered: true });
    });

    it('is shown, with the default chosen, for the Input the default looks to be, until one is opened', () => {
      const { calibrations } = setup(before(0.021, true));
      expect(calibrations.shownFor(defaultChoice, laptop)).toEqual({ offset: 0.021, offered: true });
      expect(calibrations.shownFor(defaultChoice, null)).toEqual({ offset: 0.021, offered: true });
      // Never for an Input chosen.
      expect(calibrations.shownFor(mic, mic)).toEqual(fresh);
      // Nor in place of an offset the Input has of its own.
      calibrations.set(laptop, { offset: 0.04, offered: true });
      expect(calibrations.shownFor(defaultChoice, laptop)).toEqual({ offset: 0.04, offered: true });
      // Looking moves nothing.
      expect(calibrations.of(null)).toEqual({ offset: 0.021, offered: true });
    });

    it('moves nothing from a device that had nothing kept', () => {
      const { calibrations } = setup({ 'bandmate.input': JSON.stringify(mic) });
      expect(calibrations.of(mic)).toEqual(fresh);
    });
  });

  it('is the offset another tab calibrates, and fresh again once another tab clears storage', () => {
    const { calibrations, values, otherTab } = setup();
    new InputCalibrations(storage(values), new EventTarget()).set(mic, { offset: 0.034, offered: true });
    otherTab('bandmate.latencyOffsets');
    expect(calibrations.of(mic)).toEqual({ offset: 0.034, offered: true });

    for (const key of Object.keys(values)) delete values[key];
    otherTab(null);
    expect(calibrations.of(mic)).toEqual(fresh);
  });

  it('is uncalibrated when what is kept is unreadable', () => {
    expect(setup({ 'bandmate.latencyOffsets': '{nope' }).calibrations.of(mic)).toEqual(fresh);
    const odd = JSON.stringify({ inputs: [{ ...mic, offset: -1, offered: true }, { deviceId: 3 }] });
    expect(setup({ 'bandmate.latencyOffsets': odd }).calibrations.of(mic)).toEqual({ offset: null, offered: true });
  });

  it('stays as calibrated where storage is blocked, until reload, whatever another tab changes', () => {
    const { calibrations, otherTab, reloaded } = setup({}, true);
    calibrations.set(mic, { offset: 0.021, offered: true });
    otherTab('bandmate.input');
    expect(calibrations.of(mic)).toEqual({ offset: 0.021, offered: true });
    expect(reloaded().of(mic)).toEqual(fresh);
  });
});
