// Recordings kept in the browser, in IndexedDB, from when they start until
// the server confirms their upload, so a crashed tab or a failed upload
// doesn't lose a Take (see recovery.ts for where one goes once kept). What's
// captured is written in chunks as it comes, along with the Song, and where
// the recording was going. Where the browser can't keep them, e.g. in some
// private windows, recording works as ever, just without the copy.
//
// While a tab records or uploads one, it holds a lock named after it, so
// another tab open on the same Song doesn't offer it back meanwhile.
import { samplesFrom, type Batch } from './capture';
import type { Unsaved } from './recovery';

/** A recording kept in the browser, and where it was going. */
export interface UnsavedTake extends Unsaved {
  /** Its key in the browser's store, chosen before it's written, so it's locked from the start. */
  id: string;
  songId: number;
  sampleRate: number;
  /** The frame its capture began at, lead-in included: what came before is dropped. */
  first: number;
  /** When it started, as an ISO time. */
  recordedAt: string;
}

const dbName = 'bandmate';
const takesStore = 'unsavedTakes';
const chunksStore = 'unsavedTakeChunks';

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(takesStore, { keyPath: 'id' }).createIndex('songId', 'songId');
      db.createObjectStore(chunksStore, { autoIncrement: true }).createIndex('takeId', 'takeId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

/** Waits for a request, or for a transaction to finish. */
function done<T>(request: IDBRequest<T>): Promise<T>;
function done(transaction: IDBTransaction): Promise<void>;
function done<T>(r: IDBRequest<T> | IDBTransaction): Promise<T | void> {
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

function lockName(id: string): string {
  return `bandmate.unsavedTake.${id}`;
}

/** The ids of the recordings being recorded or uploaded in some tab now. */
async function busy(): Promise<Set<string>> {
  try {
    const { held = [] } = (await navigator.locks?.query()) ?? {};
    return new Set(held.map((l) => l.name ?? ''));
  } catch {
    return new Set();
  }
}

// How many seconds' worth of batches are written at once.
const chunkSeconds = 0.5;

/**
 * A recording being kept: batches handed to it are written as they come,
 * a chunk at a time, until it's either finished or forgotten. Nothing it
 * does fails: where the browser can't keep it, it keeps nothing.
 */
export class Keeper {
  #id: Promise<string | null>;
  // Each write waits for the one before, so they're in order.
  #writes: Promise<unknown>;
  #pending: Batch[] = [];
  #pendingFrames = 0;
  // How many frames make a chunk.
  #chunk: number;
  #release: () => void = () => {};

  /** Starts keeping a recording for a Song. */
  constructor(details: Omit<UnsavedTake, 'id'>) {
    this.#id = (async () => {
      const id = crypto.randomUUID();
      await this.#lock(id);
      const tx = (await open()).transaction(takesStore, 'readwrite');
      tx.objectStore(takesStore).add({ ...details, id });
      await done(tx);
      return id;
    })().catch(() => null);
    this.#writes = this.#id;
    this.#chunk = details.sampleRate * chunkSeconds;
  }

  /** Takes the id's lock, where the browser has locks, and keeps it until released; resolves once taken. */
  #lock(id: string): Promise<void> {
    const held = new Promise<void>((resolve) => (this.#release = resolve));
    return new Promise((taken) => {
      if (!navigator.locks) return taken();
      navigator.locks
        .request(lockName(id), () => {
          taken();
          return held;
        })
        .catch(() => taken());
    });
  }

  /** Keeps a batch, with the others once there's a chunk's worth. */
  add(batch: Batch) {
    this.#pending.push(batch);
    this.#pendingFrames += batch.samples.length;
    if (this.#pendingFrames >= this.#chunk) this.#flush();
  }

  #flush() {
    const batches = this.#pending;
    if (batches.length === 0) return;
    this.#pending = [];
    this.#pendingFrames = 0;
    this.#writes = this.#writes.then(async () => {
      const takeId = await this.#id;
      if (takeId === null) return;
      const tx = (await open()).transaction(chunksStore, 'readwrite');
      tx.objectStore(chunksStore).add({ takeId, batches });
      await done(tx);
    }).catch(() => {});
  }

  /** Writes what's left, and resolves to the recording's id, or null if it couldn't be kept. */
  async finish(): Promise<string | null> {
    this.#flush();
    await this.#writes;
    return this.#id;
  }

  /** Lets another tab offer it back, e.g. once its upload failed. */
  release() {
    this.#release();
  }

  /** Drops it, e.g. once its upload is confirmed. */
  async forget() {
    const id = await this.finish();
    this.release();
    if (id !== null) await forgetUnsaved(id);
  }
}

/**
 * The recordings kept for a Song that no tab is recording or uploading, in
 * the order they were made. Empty where the browser can't keep them.
 */
export async function unsavedTakes(songId: number): Promise<UnsavedTake[]> {
  try {
    const db = await open();
    const all = await done(db.transaction(takesStore).objectStore(takesStore).index('songId').getAll(songId));
    const held = await busy();
    return (all as UnsavedTake[])
      .filter((t) => !held.has(lockName(t.id)))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  } catch {
    return [];
  }
}

/** What a recording kept captured, from its first frame on. */
export async function unsavedSamples(take: UnsavedTake): Promise<Float32Array<ArrayBuffer>> {
  const db = await open();
  const chunks = await done(db.transaction(chunksStore).objectStore(chunksStore).index('takeId').getAll(take.id));
  return samplesFrom(
    (chunks as { batches: Batch[] }[]).flatMap((c) => c.batches),
    take.first,
  );
}

/**
 * Holds a recording's lock while it's uploaded, so no other tab offers it
 * meanwhile; resolves to what upload does, or null without uploading if
 * another tab holds it.
 */
export async function whileHeld<T>(id: string, upload: () => Promise<T>): Promise<T | null> {
  if (!navigator.locks) return upload();
  return navigator.locks.request(lockName(id), { ifAvailable: true }, (lock) => (lock ? upload() : null));
}

/** Drops a recording kept, and what it captured. */
export async function forgetUnsaved(id: string) {
  try {
    const db = await open();
    const tx = db.transaction([takesStore, chunksStore], 'readwrite');
    tx.objectStore(takesStore).delete(id);
    const chunks = tx.objectStore(chunksStore);
    for (const key of await done(chunks.index('takeId').getAllKeys(id))) chunks.delete(key);
    await done(tx);
  } catch {
    // Offered again next time, to discard then.
  }
}
