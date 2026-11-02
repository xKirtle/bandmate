import { untrack } from 'svelte';
import { InputLevel, openProblem } from './capture';
import type { InputChoice } from './inputSettings';
import { audioContext } from './timelinePlayer';

// An Input held open for its latest samples, as a level meter and the Tuner
// hold one: from start() till stop(), or till the component that made it
// goes. While it's on, it opens again as it's given another Input, and as
// an Input is plugged in or out where that's the one given, gone or come
// back, or where opening it failed. Made while a component is set up, as
// it watches the devices while that's mounted.

/** The Input to open, and the one to open where it's gone, if not the default input. */
export interface InputToOpen {
  choice: InputChoice;
  instead?: InputChoice;
}

export interface OpenedInputOptions {
  /** How many of its latest samples it keeps, a power of two, as InputLevel.open takes. */
  size?: number;
  /** Why it couldn't be opened, in words to show, from what opening it threw. */
  say?: (e: unknown) => string;
  /** Whether a failure to open it stops it, rather than leaving it on to try again as an Input is plugged in. */
  stopOnFailure?: boolean;
  /** Hears each opening of it: the Input open, or null where it couldn't be opened. */
  onOpen?: (level: InputLevel | null) => void;
}

/** Tells one Input to open from another by device and channel, whatever their labels. */
const keyOf = ({ choice, instead }: InputToOpen) =>
  JSON.stringify([choice.deviceId, choice.channel, instead?.deviceId, instead?.channel]);

export class OpenedInput {
  /** The Input open, or null while it isn't. */
  level = $state.raw<InputLevel | null>(null);
  /** Whether it's being opened. */
  opening = $state(false);
  /** Why it couldn't be opened the last time it was tried, or null. */
  problem = $state<string | null>(null);
  /** Whether it's on: from start() till stop(), open, being opened, or failed and waiting to try again. */
  on = $state(false);

  #given: () => InputToOpen;
  #options: OpenedInputOptions;
  // The Input opened, by its key, to open another given in its place; null while it's off.
  #opened: string | null = null;
  // Each opening, so a slower one started before is let go.
  #generation = 0;

  constructor(given: () => InputToOpen, options: OpenedInputOptions = {}) {
    this.#given = given;
    this.#options = options;
    // Another Input given, e.g. chosen in another tab: it's opened in place of the one before.
    $effect(() => {
      const key = keyOf(given());
      if (this.#opened !== null && key !== this.#opened) untrack(() => this.start());
    });
    $effect(() => {
      const devices = navigator.mediaDevices;
      const changed = () => void this.#devicesChanged();
      devices?.addEventListener('devicechange', changed);
      return () => {
        devices?.removeEventListener('devicechange', changed);
        this.stop();
      };
    });
  }

  /** The name of the device given when it isn't connected, so another is open in its place; null otherwise. */
  get gone(): string | null {
    return this.level?.gone ?? null;
  }

  /** Opens the Input given, in place of any open. */
  async start() {
    const mine = ++this.#generation;
    this.#close();
    this.on = true;
    this.opening = true;
    this.problem = null;
    // Resumed while the click that started it still counts.
    audioContext()
      .resume()
      .catch(() => {});
    const given = $state.snapshot(this.#given());
    this.#opened = keyOf(given);
    let level: InputLevel | null = null;
    try {
      level = await InputLevel.open(audioContext(), given.choice, { size: this.#options.size, instead: given.instead });
      if (mine !== this.#generation) {
        level.close();
        return;
      }
      this.level = level;
    } catch (e) {
      if (mine !== this.#generation) return;
      this.problem = (this.#options.say ?? openProblem)(e);
      if (this.#options.stopOnFailure) this.stop();
    }
    this.opening = false;
    this.#options.onOpen?.(level);
  }

  /** Lets go of the Input, leaving it off, and any problem opening it shown. */
  stop() {
    this.#generation++;
    this.#close();
    this.#opened = null;
    this.on = false;
    this.opening = false;
  }

  #close() {
    this.level?.close();
    this.level = null;
  }

  // An input plugged in or out: the one given opened again if it's the
  // one that went or came back, or if opening it failed.
  async #devicesChanged() {
    // Off, it's left so: it never starts on its own.
    if (!this.on) return;
    const { choice } = this.#given();
    let present = true;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      present = choice.deviceId === '' || devices.some((d) => d.deviceId === choice.deviceId);
    } catch {
      // Can't tell, so it's left as it is, unless it failed.
    }
    // Asked again, as it may have been stopped while the devices were listed.
    if (this.on && (this.problem !== null || (this.gone !== null) === present)) void this.start();
  }
}
