// The Beat being added, in the Beat Library or the Beat Picker: a file read
// into a draft with the details it suggests, or one fetched from a link,
// waiting on the server, checked and then added.
import type { FromLink } from './AddFromLink.svelte';
import type { Beat, BeatDetails, DecodedAudio, Fetched } from './api';
import { fromDraft, toDraft, type BeatDraft } from './beatDraft';
import { suggestForFile } from './beatTags';
import { beatWithSource } from './sameSource';
import { prepareUpload } from './upload';

/** A file read: decoded, with the details it suggests. */
export interface BeatRead {
  decoded: DecodedAudio;
  draft: BeatDraft;
}

/** Reads a file to add as a Beat, failing with a message to show if it can't be added. */
export type BeatReader = (file: File) => Promise<BeatRead>;

/**
 * The browser's reader: checks a file is under the upload limit, as it is
 * when asked, and decodes it, suggesting details from its tags and name.
 */
export function fileReader(maxUploadBytes: () => number): BeatReader {
  return async (file) => {
    const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes()), suggestForFile(file)]);
    return { decoded, draft: toDraft(suggestion) };
  };
}

/** The api calls adding a Beat makes; the api module's own are the real ones. */
export interface BeatAddApi {
  addBeat: (file: File, details: BeatDetails, decoded: DecodedAudio) => Promise<Beat>;
  addFetchedBeat: (id: string, details: BeatDetails, decoded: DecodedAudio) => Promise<Beat>;
  discardFetched: (id: string) => Promise<unknown>;
}

/**
 * A file being added, waiting for its details. One fetched from a link is
 * already on the server, waiting there, and is previewed from the copy read
 * to decode it, keeping what the link gave, such as its clean link.
 */
export interface Adding extends BeatRead {
  file: File;
  fetched?: Fetched & { previewUrl: string };
}

/**
 * The one Beat being added, from a file or a link. A fetched file that isn't
 * added is discarded as soon as it's left, another file is read, or the page
 * or Picker closes; the server's expiry is the fallback for a closed tab.
 */
export class BeatToAdd {
  /** The Beat being added, if any. */
  adding = $state<Adding | null>(null);
  /** What it's doing, while it's reading or adding. */
  busy = $state<string | null>(null);
  /** Why the last read or add failed, until the next. */
  error = $state<string | null>(null);

  #read: BeatReader;
  #api: BeatAddApi;
  /** The read under way, if one is: only its file is held, once read. */
  #reading: object | null = null;
  /** The Beat being added that's on its way to the server, if one is. */
  #sending: Adding | null = null;
  /** Whether the page or Picker it belongs to has closed. */
  #closed = false;

  constructor(read: BeatReader, api: BeatAddApi) {
    this.#read = read;
    this.#api = api;
  }

  /** Reads a file into the Beat being added, in place of any other. */
  async read(file: File): Promise<void> {
    this.#drop();
    this.error = null;
    if (this.#closed) return;
    const reading = (this.#reading = {});
    this.busy = `Reading “${file.name}”…`;
    try {
      const read = await this.#read(file);
      if (this.#reading === reading) this.adding = { file, ...read };
    } catch (e) {
      if (this.#reading === reading) this.error = (e as Error).message;
    } finally {
      if (this.#reading === reading) {
        this.#reading = null;
        this.busy = null;
      }
    }
  }

  /** Takes a file fetched from a link, as the link box hands it over, in place of any other. */
  take({ fetched, file, decoded, draft }: FromLink): void {
    this.#forgetRead();
    this.#drop();
    this.error = null;
    if (this.#closed) {
      this.#discard(fetched.id);
      return;
    }
    this.adding = { file, decoded, draft, fetched: { ...fetched, previewUrl: URL.createObjectURL(file) } };
  }

  /**
   * Adds the Beat being added with its details, resolving with the Beat
   * added, or with nothing if its details are invalid or adding failed,
   * keeping it and saying why.
   */
  async add(): Promise<Beat | null> {
    const adding = this.adding;
    if (!adding || this.#sending) return null;
    const details = fromDraft(adding.draft);
    if (typeof details === 'string') {
      this.error = details;
      return null;
    }
    const { fetched } = adding;
    this.busy = fetched ? 'Adding…' : 'Uploading…';
    this.error = null;
    this.#sending = adding;
    try {
      const beat = fetched
        ? await this.#api.addFetchedBeat(fetched.id, details, adding.decoded)
        : await this.#api.addBeat(adding.file, details, adding.decoded);
      if (this.adding === adding) this.#drop(true);
      return beat;
    } catch (e) {
      if (this.adding === adding) this.error = (e as Error).message;
      return null;
    } finally {
      this.#sending = null;
      if (this.#reading === null) this.busy = null;
    }
  }

  /**
   * The Beat already in the Library, given its Beats, from the link of the
   * Beat being added, if any: it's warned of, but can be added again.
   */
  alreadyInLibrary<B extends Pick<Beat, 'sourceLink'>>(library: readonly B[] | null): B | null {
    const fetched = this.adding?.fetched;
    return fetched && library ? beatWithSource(library, fetched.sourceLink) : null;
  }

  /** Leaves the form: the Beat being added is dropped, with the last error. */
  leave(): void {
    this.#forgetRead();
    this.#drop();
    this.error = null;
  }

  /** Leaves for good, as the page or Picker closes: a file handed over afterwards is dropped. */
  close(): void {
    this.leave();
    this.#closed = true;
  }

  /** Forgets a read under way: what it reads, or why it fails, is never held. */
  #forgetRead() {
    if (this.#reading === null) return;
    this.#reading = null;
    this.busy = null;
  }

  /**
   * Empties the Beat being added. A fetched file it held stops waiting on the
   * server, unless it was just added.
   */
  #drop(added = false) {
    const fetched = this.adding?.fetched;
    if (fetched) {
      URL.revokeObjectURL(fetched.previewUrl);
      // One on its way to being added is the add's: it either lands or expires.
      if (!added && this.#sending !== this.adding) this.#discard(fetched.id);
    }
    this.adding = null;
  }

  #discard(id: string) {
    // The server's expiry is the fallback.
    this.#api.discardFetched(id).catch(() => {});
  }
}
