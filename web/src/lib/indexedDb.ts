// Waiting on the browser's IndexedDB, which answers by events, as promises.

/** Waits for a request, or for a transaction to finish. */
export function done<T>(request: IDBRequest<T>): Promise<T>;
export function done(transaction: IDBTransaction): Promise<void>;
export function done<T>(r: IDBRequest<T> | IDBTransaction): Promise<T | void> {
  return new Promise((resolve, reject) => {
    if (r instanceof IDBTransaction) {
      r.oncomplete = () => resolve();
      r.onabort = r.onerror = () => reject(r.error);
    } else {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }
  });
}
