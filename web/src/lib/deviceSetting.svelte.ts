// A Device Setting as the app shares it: one value for every part of the
// page that shows or changes it, read from this device's storage, kept there
// when it's set, and read again when another of this device's tabs keeps a
// new one, so a choice made in one tab shows in all of them.

/** How one Device Setting is kept on this device: where, and how it's read and kept. */
export interface DeviceSettingKind<T> {
  key: string;
  read: (storage: Storage | undefined) => T;
  store: (storage: Storage | undefined, value: T) => void;
}

export class DeviceSetting<T> {
  #kind: DeviceSettingKind<T>;
  #storage: Storage | undefined;
  #value: T = $state() as T;

  /** `tabs` tells of other tabs' changes to storage: the window, in the app. */
  constructor(kind: DeviceSettingKind<T>, storage: Storage | undefined, tabs: EventTarget) {
    this.#kind = kind;
    this.#storage = storage;
    this.#value = kind.read(storage);
    // Another tab kept this setting, or storage was cleared (a null key).
    tabs.addEventListener('storage', (event) => {
      const { key } = event as StorageEvent;
      if (key === null || key === kind.key) this.#value = kind.read(storage);
    });
  }

  /** The value on this device. */
  get value(): T {
    return this.#value;
  }

  /** Sets the value on this device, and keeps it. */
  set(value: T) {
    this.#value = value;
    this.#kind.store(this.#storage, value);
  }
}
