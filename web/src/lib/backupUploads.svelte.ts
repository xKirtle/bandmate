// Uploading Backups' files on Settings' Backups tab, picked or dropped: one
// after another, a run's queue taking those added while it goes, saying
// which is being sent and how far it has got, and naming each that
// couldn't be uploaded, with why, without stopping the rest.
import type { Backup } from './api';
import { backupName } from './backups';
import type { UploadOptions, UploadProgress } from './progressUpload';

/** Sends one Backup's file, answering with the Backup kept, and failing with why it was refused. */
type Send<B> = (file: File, options: UploadOptions) => Promise<B>;

/** A Backup kept from an upload, with the name of the file it came from. */
export interface Uploaded<B> {
  backup: B;
  file: string;
}

/** What the uploads tell as they go. */
interface Told<B> {
  /** A Backup has been kept, from the file named. */
  added: (backup: B, file: string) => void;
  /** The run is over, done or cancelled, having added these, in order. */
  done: (added: Uploaded<B>[]) => void;
}

/** A file that couldn't be uploaded, and why. */
export interface Failure {
  file: string;
  reason: string;
}

// The server's own words for a file that isn't a Backup.
const notABackup = "the file isn't a Bandmate Backup";

/** Whether a file is named as a Backup's file is: only those are sent. */
function isBackupFile(file: File): boolean {
  return /\.bandmate$/i.test(file.name);
}

export class BackupUploads<B> {
  /** The files that couldn't be uploaded in the last run, with why, until the next starts. */
  failures = $state<Failure[]>([]);
  /** The file being uploaded, while one is, and how far it has got. */
  current = $state<{ file: string; progress: UploadProgress } | null>(null);
  /** Which of the run's files is being uploaded, of how many so far, while there are several. */
  readonly count: { at: number; of: number } | null = $derived.by(() => {
    const of = this.#at + this.#queue.length;
    return this.current && of > 1 ? { at: this.#at, of } : null;
  });

  #send: Send<B>;
  #told: Told<B>;
  /** The files waiting their turn. */
  #queue = $state<File[]>([]);
  /** How many of the run's files have had their turn, counting the one being sent. */
  #at = $state(0);
  /** Stops the run under way, if one is. */
  #stop: AbortController | null = null;
  /** Whether the run was stopped by leaving, so it tells nothing more. */
  #quiet = false;

  constructor(send: Send<B>, told: Told<B>) {
    this.#send = send;
    this.#told = told;
  }

  /**
   * Uploads the files that are Backups', after those already queued, and
   * refuses the rest without sending them. A new run forgets the last one's
   * failures.
   */
  add(files: File[]) {
    if (!this.#stop) this.failures = [];
    for (const file of files) {
      if (!isBackupFile(file)) this.failures.push({ file: file.name, reason: notABackup });
    }
    this.#queue.push(...files.filter(isBackupFile));
    if (!this.#stop && this.#queue.length > 0) this.#run();
  }

  /** Stops the upload under way and drops the rest of the queue. What was added is still told. */
  cancel() {
    // The run is over now, not once its upload has stopped, so files added
    // straight after start one of their own.
    this.#queue = [];
    this.#stop?.abort();
    this.#stop = null;
    this.current = null;
  }

  /** Forgets the failures, once they've been read. */
  dismissFailures() {
    this.failures = [];
  }

  /** As cancelling, but telling nothing more, ever: for when the page is left. */
  stop() {
    this.#quiet = true;
    this.cancel();
  }

  async #run() {
    const stop = new AbortController();
    this.#stop = stop;
    this.#at = 0;
    const added: Uploaded<B>[] = [];
    // A cancelled run takes no more files: the queue may already be the next run's.
    for (let file = this.#queue.shift(); file; file = stop.signal.aborted ? undefined : this.#queue.shift()) {
      const name = file.name;
      this.#at++;
      this.current = { file: name, progress: { step: 'sending', sent: 0 } };
      try {
        const backup = await this.#send(file, {
          signal: stop.signal,
          onProgress: (progress) => (this.current = { file: name, progress }),
        });
        added.push({ backup, file: name });
        if (!this.#quiet) this.#told.added(backup, name);
      } catch (e) {
        // Cancelled: the upload just stops.
        if (!stop.signal.aborted) this.failures.push({ file: name, reason: (e as Error).message });
      }
    }
    if (!stop.signal.aborted) {
      this.current = null;
      this.#stop = null;
    }
    if (!this.#quiet) this.#told.done(added);
  }
}

/**
 * What a run of uploads added, if anything: the one Backup by name, with
 * the file it came from, since it's listed by when it was made, maybe far
 * down; several by how many.
 */
export function addedNote(added: Uploaded<Backup>[]): string | null {
  if (added.length === 0) return null;
  if (added.length > 1) return `Added ${added.length} Backups.`;
  const [{ backup, file }] = added;
  return `Added “${backupName(backup)}” from “${file}”.`;
}

/** The files a run of uploads couldn't upload, if any, each with why. */
export function failedNote(failures: Failure[]): string | null {
  if (failures.length === 0) return null;
  const named = failures.map(({ file, reason }) => `“${file}” (${reason})`);
  const last = named.pop();
  return `Couldn't upload ${named.length > 0 ? `${named.join(', ')} and ${last}` : last}`;
}
