// A Device Setting as the app shares it: one value for every part of the
// page that shows or changes it, read from this device's storage, kept there
// when it's set, and read again when another of this device's tabs keeps a
// new one, so a choice made in one tab shows in all of them.

/** How one Device Setting is kept in this device's storage: under which key, and how it's read and kept. */
export interface DeviceSettingStorage<T> {
  key: string;
  read: (storage: Storage | undefined) => T;
  store: (storage: Storage | undefined, value: T) => void;
  /**
   * Shows the value, for a setting with somewhere to show it, e.g. the
   * Palette on the page: called with the value read on construction, from
   * the constructor itself, with one set, and with one another tab's change
   * or a cleared storage brings in. It's called every time, whether or not
   * the value differs from the one held, so a tab keeping the value this
   * one already has shows it again. A setting that shows itself wherever
   * it's read leaves this out.
   */
  shown?: (value: T) => void;
}

export class DeviceSetting<T> {
  #kind: DeviceSettingStorage<T>;
  #storage: Storage | undefined;
  #value: T = $state() as T;

  /** `tabs` tells of other tabs' changes to storage: the window, in the app. */
  constructor(kind: DeviceSettingStorage<T>, storage: Storage | undefined, tabs: EventTarget) {
    this.#kind = kind;
    this.#storage = storage;
    this.#take(kind.read(storage));
    // Another tab kept this setting, or storage was cleared (a null key).
    tabs.addEventListener('storage', (event) => {
      const { key } = event as StorageEvent;
      if (key === null || key === kind.key) this.#take(kind.read(storage));
    });
  }

  /** The value on this device. */
  get value(): T {
    return this.#value;
  }

  /** Sets the value on this device, and keeps it. */
  set(value: T) {
    // Kept first, so a setting shown the value sees it already kept.
    this.#kind.store(this.#storage, value);
    this.#take(value);
  }

  // Takes a new value, and shows it where the setting says how.
  #take(value: T) {
    this.#value = value;
    this.#kind.shown?.(value);
  }
}
