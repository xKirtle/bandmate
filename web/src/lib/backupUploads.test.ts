import { describe, expect, it } from 'vitest';
import { addedNote, BackupUploads, failedNote } from './backupUploads.svelte';
import type { UploadOptions } from './progressUpload';

/** A Backup as the server answers an upload with it, standing in for the real one. */
type Kept = { id: number; from: string };

/** One upload sent, which the test answers when it likes. */
interface Sent {
  file: string;
  options: UploadOptions;
  keep: () => void;
  refuse: (reason: string) => void;
}

/** A server the uploads are sent to, one at a time, answering when told. */
function fakeServer() {
  const sent: Sent[] = [];
  let ids = 0;
  const send = (file: File, options: UploadOptions) =>
    new Promise<Kept>((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      sent.push({
        file: file.name,
        options,
        keep: () => resolve({ id: ++ids, from: file.name }),
        refuse: (reason) => reject(new Error(reason)),
      });
    });
  return { sent, send };
}

/** Lets the uploads' run go on to its next step. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

const file = (name: string) => new File(['PK'], name);

function uploads() {
  const server = fakeServer();
  const added: { backup: Kept; file: string }[] = [];
  const done: { backup: Kept; file: string }[][] = [];
  const queue = new BackupUploads<Kept>(server.send, {
    added: (backup, file) => added.push({ backup, file }),
    done: (all) => done.push(all),
  });
  return { queue, sent: server.sent, added, done };
}

describe('BackupUploads', () => {
  it('uploads the Backups added one after another, in order', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate')]);
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate']);
    sent[0].keep();
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'b.bandmate']);
  });

  it("refuses a file that isn't a Backup without sending it, naming it", async () => {
    const { queue, sent } = uploads();
    queue.add([file('notes.txt'), file('a.bandmate')]);
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate']);
    expect(queue.failures).toEqual([{ file: 'notes.txt', reason: "the file isn't a Bandmate Backup" }]);
  });

  it("goes on after a file the server refuses, naming it with the server's reason", async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate')]);
    await settle();
    sent[0].refuse('the Backup is damaged');
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'b.bandmate']);
    expect(queue.failures).toEqual([{ file: 'a.bandmate', reason: 'the Backup is damaged' }]);
  });

  it('shows the file being uploaded and how far it has got', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate')]);
    await settle();
    expect(queue.current).toEqual({ file: 'a.bandmate', progress: { step: 'sending', sent: 0 } });
    sent[0].options.onProgress?.({ step: 'sending', sent: 0.5 });
    expect(queue.current).toEqual({ file: 'a.bandmate', progress: { step: 'sending', sent: 0.5 } });
    sent[0].keep();
    await settle();
    expect(queue.current).toBeNull();
  });

  it('counts which of several is being uploaded, and only while there are several', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate')]);
    await settle();
    expect(queue.count).toBeNull();
    queue.add([file('b.bandmate'), file('c.bandmate')]);
    expect(queue.count).toEqual({ at: 1, of: 3 });
    sent[0].keep();
    await settle();
    expect(queue.count).toEqual({ at: 2, of: 3 });
  });

  it('adds files added during a run to its queue, after those already in it', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate')]);
    await settle();
    queue.add([file('c.bandmate')]);
    sent[0].keep();
    await settle();
    sent[1].keep();
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'b.bandmate', 'c.bandmate']);
  });

  it('tells each Backup kept as it is, and all of them once the run is over', async () => {
    const { queue, sent, added, done } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate'), file('c.bandmate')]);
    await settle();
    sent[0].keep();
    await settle();
    expect(added).toEqual([{ backup: { id: 1, from: 'a.bandmate' }, file: 'a.bandmate' }]);
    expect(done).toEqual([]);
    sent[1].refuse('the Backup is damaged');
    await settle();
    sent[2].keep();
    await settle();
    expect(done).toEqual([
      [
        { backup: { id: 1, from: 'a.bandmate' }, file: 'a.bandmate' },
        { backup: { id: 2, from: 'c.bandmate' }, file: 'c.bandmate' },
      ],
    ]);
  });

  it('cancelling stops the upload and drops the rest of the queue, without a failure', async () => {
    const { queue, sent, done } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate'), file('c.bandmate')]);
    await settle();
    sent[0].keep();
    await settle();
    queue.cancel();
    await settle();
    expect(sent[1].options.signal?.aborted).toBe(true);
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'b.bandmate']);
    expect(queue.current).toBeNull();
    expect(queue.failures).toEqual([]);
    expect(done).toEqual([[{ backup: { id: 1, from: 'a.bandmate' }, file: 'a.bandmate' }]]);
  });

  it('starts a new run afresh, after a cancelled one', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate')]);
    await settle();
    queue.cancel();
    await settle();
    queue.add([file('c.bandmate')]);
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'c.bandmate']);
    expect(sent[1].options.signal?.aborted).toBe(false);
    expect(queue.count).toBeNull();
  });

  it('starts a new run for files added straight after cancelling, before the upload has stopped', async () => {
    const { queue, sent } = uploads();
    queue.add([file('a.bandmate')]);
    await settle();
    queue.cancel();
    queue.add([file('b.bandmate')]);
    await settle();
    expect(sent.map((s) => s.file)).toEqual(['a.bandmate', 'b.bandmate']);
    expect(sent[1].options.signal?.aborted).toBe(false);
    expect(queue.current).toEqual({ file: 'b.bandmate', progress: { step: 'sending', sent: 0 } });
  });

  it('keeps failures through a run, and forgets them when the next starts', async () => {
    const { queue, sent } = uploads();
    queue.add([file('notes.txt'), file('a.bandmate')]);
    await settle();
    queue.add([file('song.mp3')]);
    expect(queue.failures.map((f) => f.file)).toEqual(['notes.txt', 'song.mp3']);
    sent[0].keep();
    await settle();
    queue.add([file('b.bandmate')]);
    expect(queue.failures).toEqual([]);
  });

  it('stopping, as on leaving the page, aborts quietly, telling nothing', async () => {
    const { queue, sent, done } = uploads();
    queue.add([file('a.bandmate'), file('b.bandmate')]);
    await settle();
    queue.stop();
    await settle();
    expect(sent[0].options.signal?.aborted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(done).toEqual([]);
  });
});

describe('addedNote', () => {
  // 18:30 on 4 Oct 2026, in the time zone the tests run in.
  const made = new Date(2026, 9, 4, 18, 30).toISOString();
  const backup = {
    id: 1,
    createdAt: made,
    songs: 3,
    allSongs: false,
    beats: 0,
    beatLibrary: false,
    size: 8192,
    name: '',
  };

  it('names the Backup one upload added, and the file it came from', () => {
    expect(addedNote([{ backup, file: 'old.bandmate' }])).toBe('Added “4 Oct 2026 · 3 Songs” from “old.bandmate”.');
  });

  it('counts the Backups several uploads added', () => {
    expect(
      addedNote([
        { backup, file: 'a.bandmate' },
        { backup, file: 'b.bandmate' },
        { backup, file: 'c.bandmate' },
      ]),
    ).toBe('Added 3 Backups.');
  });

  it('says nothing when none was added', () => {
    expect(addedNote([])).toBeNull();
  });
});

describe('failedNote', () => {
  it('names the file that could not be uploaded, with why', () => {
    expect(failedNote([{ file: 'notes.txt', reason: "the file isn't a Bandmate Backup" }])).toBe(
      "Couldn't upload “notes.txt” (the file isn't a Bandmate Backup)",
    );
  });

  it('names each of several, with why', () => {
    expect(
      failedNote([
        { file: 'notes.txt', reason: "the file isn't a Bandmate Backup" },
        { file: 'a.bandmate', reason: 'the Backup is damaged' },
        { file: 'b.bandmate', reason: 'made by a newer Bandmate' },
      ]),
    ).toBe(
      "Couldn't upload “notes.txt” (the file isn't a Bandmate Backup), “a.bandmate” (the Backup is damaged) and “b.bandmate” (made by a newer Bandmate)",
    );
  });

  it('says nothing when none failed', () => {
    expect(failedNote([])).toBeNull();
  });
});
