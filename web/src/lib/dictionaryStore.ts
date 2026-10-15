// The rhyming dictionaries downloaded to this device, kept in the browser's
// IndexedDB, as unsavedTakes.ts keeps recordings: which are downloaded, and
// apart from that, the data of each, so listing them doesn't read it all.
import { done } from './indexedDb';
import type { DictionaryStore, SetUpDictionary, StoredDictionary } from './rhymingDictionaries.svelte';

const dbName = 'bandmate.dictionaries';
const setUpStore = 'setUp';
const dataStore = 'data';

let opened: Promise<IDBDatabase> | null = null;

/**
 * Codes kept under before Languages were named by their BCP 47 codes: a
 * dictionary kept under one is its Language's old data, so it's removed,
 * and the Language it became counts as not downloaded until it's downloaded.
 */
const oldCodes = ['pt'];

function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = ({ oldVersion }) => {
      const db = request.result;
      if (oldVersion < 1) {
        db.createObjectStore(setUpStore, { keyPath: 'code' });
        db.createObjectStore(dataStore, { keyPath: 'code' });
      }
      if (oldVersion < 2) {
        const tx = request.transaction!;
        for (const code of oldCodes) {
          tx.objectStore(setUpStore).delete(code);
          tx.objectStore(dataStore).delete(code);
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer Bandmate in another tab upgrades it: let it, and open it anew next time.
      db.onversionchange = () => {
        db.close();
        opened = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

/** The dictionaries kept in this browser. Where it keeps none, e.g. in some private windows, each call fails. */
export const dictionaryStore: DictionaryStore = {
  async list() {
    const db = await open();
    return (await done(db.transaction(setUpStore).objectStore(setUpStore).getAll())) as SetUpDictionary[];
  },

  async get(code) {
    const db = await open();
    const tx = db.transaction([setUpStore, dataStore]);
    const [setUp, data] = await Promise.all([
      done(tx.objectStore(setUpStore).get(code)) as Promise<SetUpDictionary | undefined>,
      done(tx.objectStore(dataStore).get(code)) as Promise<{ etag: string; text: string } | undefined>,
    ]);
    return setUp && data ? { ...setUp, etag: data.etag, text: data.text } : undefined;
  },

  async put({ code, updatedAt, etag, text }: StoredDictionary) {
    const db = await open();
    const tx = db.transaction([setUpStore, dataStore], 'readwrite');
    tx.objectStore(setUpStore).put({ code, updatedAt });
    tx.objectStore(dataStore).put({ code, etag, text });
    await done(tx);
  },

  async remove(code) {
    const db = await open();
    const tx = db.transaction([setUpStore, dataStore], 'readwrite');
    tx.objectStore(setUpStore).delete(code);
    tx.objectStore(dataStore).delete(code);
    await done(tx);
  },
};
