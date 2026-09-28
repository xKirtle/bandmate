// The first time Sync mode is switched on, a one-line hint says how to use
// it. Once seen, it's remembered on this device and not shown again.

/** Where it's kept on this device that the hint was seen. */
export const syncHintKey = 'bandmate.syncHintSeen';

/** Whether the hint has been seen on this device; false if that can't be read. */
export function sawSyncHint(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(syncHintKey) === '1';
  } catch {
    return false;
  }
}

/** Remembers on this device that the hint was seen. */
export function markSyncHintSeen(storage: Storage | undefined) {
  try {
    storage?.setItem(syncHintKey, '1');
  } catch {
    // Not kept, e.g. in a private window; the hint shows again next time.
  }
}
