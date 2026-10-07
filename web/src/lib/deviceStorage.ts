// This device's storage, where every Device Setting and every value simply
// remembered on the device is kept: local storage when the browser allows
// it, and nothing in a private window that refuses it.

/** This device's storage, if the browser allows it. */
export function deviceStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
