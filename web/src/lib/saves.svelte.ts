// Saves: every save the Song page and its panels make, made once per Song
// by the Song page and handed to what saves.
//
// Saves run one turn at a time, in the order they were asked for, so they
// land in that order, each built against the Song and Timeline as saved
// when its turn comes. Nothing throws: a save refused because the Song
// changed elsewhere marks it stale; any other failure becomes the save
// error, which a later save clears. Callers react to a save after awaiting
// its result: their code up to its next await runs before the next turn
// starts.
//
// A Cue change shows at once, made on top of the Song as saved (see
// cueChanges.ts), so syncing keeps its rhythm. Its save is tried again for
// a few seconds while it fails on the network or the server; if it still
// fails, it's taken back, as a whole.
//
// It keeps a list of the edits being typed, e.g. a Track's name typed in
// place (see typedField.svelte.ts): while any differs from what's saved,
// the Song has unsaved edits, so closing the tab asks first and a refresh
// doesn't replace the Song.
//
// Timeline edits and Cue changes are kept to undo, in one history (see
// history.ts), in the order they were made. An undo waits for the edits
// queued before it. A save refused as the Song changed elsewhere, or a
// refresh bringing in a change made elsewhere, forgets them all.
import { ApiError, type Song, type Timeline } from './api';
import { sameCues, savedRetrying, withCueChange, type CueChange } from './cueChanges';
import { History, restorable, type Edit, type HistoryEdit } from './history';
import type { LyricSheetChange } from './lyricSheetChanges';
import { waitFor, type SongServer, type Wait } from './songServer';

/** How a save ended: saved, failed, refused as the Song changed elsewhere, or never sent as the Song's being deleted. */
export type Submitted = 'saved' | 'failed' | 'stale' | 'closed';

/** What a Timeline edit did: the Timeline as saved before it, and the Timeline it left. */
export interface Edited {
  before: Timeline;
  after: Timeline;
}

/** What an undo or redo did, and what the Timeline goes back to with it. */
export interface Undone extends Edited {
  /** The Clips to select again: Clips deleted together, brought back, a Merge redone, or a Split redone's right halves. Null to leave the Selection as it is. */
  reselect: number[] | null;
  /** Where to return the playhead to: where a new Take undone started. Null to leave it where it is. */
  playhead: number | null;
}

/**
 * What a rarer edit, made with make, did: the Timeline it left, and how
 * it's kept to undo: as an edit that makes it again without uploading or
 * rendering anything again, or as a new Take.
 */
export interface Made {
  timeline: Timeline;
  kept: Edit | 'take';
}

/** An edit being typed, on Saves' list, e.g. a field typed in place (see typedField.svelte.ts). */
export interface Typing {
  /** Whether what's typed isn't saved yet. */
  readonly unsaved: boolean;
  /** The Section it's typed in, if any. */
  readonly section?: number;
}

export interface SavesOptions {
  /** The Song on the server. */
  server: SongServer;
  /** The Song and its Timeline, as loaded. */
  song: Song;
  timeline: Timeline;
  /** Waits between tries of a Cue change's save. */
  wait?: Wait;
  /**
   * Whether the page holds edits that aren't saved, outside Saves, e.g.
   * Details being typed or a Lyric Sheet editor open.
   */
  editsOutside?: () => boolean;
  /**
   * Hears that a refresh is about to show the Song as changed elsewhere,
   * e.g. to show its Details in the inputs.
   */
  onReplace?: (song: Song) => void;
}

export class Saves {
  #server: SongServer;
  #wait: Wait;
  #editsOutside: () => boolean;
  #onReplace: (song: Song) => void;

  #saved: Song = $state.raw()!;
  /** Cue changes not saved yet, in the order they were made. */
  #unsavedCues: { change: CueChange }[] = $state.raw([]);
  #shown = $derived(this.#unsavedCues.reduce((s, u) => withCueChange(s, u.change), this.#saved));
  /** The edits being typed, e.g. fields typed in place, unsaved while they differ from what's saved. */
  #typing: Typing[] = $state.raw([]);

  /** The Timeline as saved. */
  timeline: Timeline = $state.raw()!;
  /** Whether a save was refused, or a refresh couldn't be shown, because the Song changed elsewhere since it loaded. */
  stale = $state(false);
  /** Why the latest save failed, until a later one lands. */
  saveError = $state<string | null>(null);
  /** How many saves are queued or on their way. */
  pending = $state(0);
  /** How many times a refresh has replaced the Song and its Timeline with those changed elsewhere. */
  replaced = $state(0);

  /** Whether there's an edit to undo, or one to redo. */
  canUndo = $state(false);
  canRedo = $state(false);

  // Every Timeline edit and Cue edit is kept to undo, in the order they
  // were made, for as long as the page is open. Once the Song changed
  // elsewhere, they'd no longer undo what they did, so they're forgotten.
  #history = new History();
  /** Undoable edits queued, which an undo waits for. */
  #undoablesQueued = 0;
  /**
   * Counts the Cue edits that failed, so were taken back: an undo pressed
   * for one before it failed has nothing to undo, rather than undoing the
   * edit before it.
   */
  #cueEditsFailed = 0;

  #queue: Promise<unknown> = Promise.resolve();
  /** Counts the saves queued. */
  #turns = 0;
  /** The latest save queued before a save error that only a save asked for since clears. */
  #errorKeptUntil = 0;
  #closed = false;
  #holds = 0;
  #refreshOnRelease = false;

  constructor(options: SavesOptions) {
    this.#server = options.server;
    this.#wait = options.wait ?? waitFor;
    this.#editsOutside = options.editsOutside ?? (() => false);
    this.#onReplace = options.onReplace ?? (() => {});
    this.#saved = options.song;
    this.timeline = options.timeline;
  }

  /** The Song as shown: as saved, with the Cue changes not saved yet made on top. */
  get song(): Song {
    return this.#shown;
  }

  /** The Song as saved. */
  get saved(): Song {
    return this.#saved;
  }

  /** Whether anything isn't saved yet: saves on their way, Cue changes, edits being typed, or edits outside Saves. */
  get unsaved(): boolean {
    return (
      this.pending > 0 || this.#unsavedCues.length > 0 || this.#typing.some((t) => t.unsaved) || this.#editsOutside()
    );
  }

  /** Whether an edit being typed in a Section isn't saved yet. */
  unsavedIn(sectionId: number): boolean {
    return this.#typing.some((t) => t.section === sectionId && t.unsaved);
  }

  /**
   * Puts an edit being typed, e.g. a field typed in place, on the list
   * whose edits not saved yet the Song has, until the function returned is
   * called, e.g. as its field goes.
   */
  typing = (entry: Typing): (() => void) => {
    this.#typing = [...this.#typing, entry];
    return () => (this.#typing = this.#typing.filter((t) => t !== entry));
  };

  /**
   * Queues a change to the Song, built against the Song as saved when its
   * turn comes, and shows the Song it returns. Resolves to whether it was saved.
   */
  change = (op: (saved: Song) => Promise<Song>): Promise<boolean> => this.submit(op).then((ended) => ended === 'saved');

  /** Queues a Lyric Sheet change, named by its kind, like change. */
  changeLyricSheet = (change: LyricSheetChange): Promise<boolean> =>
    this.change((saved) => this.#server.apply(saved, change));

  /** Queues a change like change, resolving to how it ended. */
  submit = (op: (saved: Song) => Promise<Song>): Promise<Submitted> =>
    this.#turn(
      op,
      (s) => (this.#saved = s),
      (ended) => ended,
    );

  /**
   * Queues a Timeline edit, made against the Timeline as saved when its
   * turn comes, and keeps it to undo. Resolves to what it did, or null if
   * it wasn't saved.
   */
  edit = (edit: Edit): Promise<Edited | null> =>
    this.make(async (at) => ({ timeline: await this.#server.apply(at, edit), kept: edit }));

  /**
   * Queues a rarer edit to the Timeline that the caller makes itself, e.g.
   * importing a Sound, saving a Take or a Merge. Its work runs in its turn,
   * against the Song and Timeline as saved then, with the Song on the
   * server to write through, and says how it's kept to undo. Resolves to
   * what it did, or null if it wasn't saved, e.g. when the work throws,
   * whose message becomes the save error.
   */
  make = (work: (at: Song, timeline: Timeline, server: SongServer) => Promise<Made>): Promise<Edited | null> => {
    let edited: Edited | null = null;
    this.#undoablesQueued++;
    return this.#turn(
      (at) => work(at, this.timeline, this.#server),
      ({ timeline, kept }) => {
        const before = this.timeline;
        if (kept === 'take') this.#history.recordTake(before, timeline);
        else this.#history.record(kept, before, timeline);
        this.#showHistory();
        this.#showTimeline(timeline);
        edited = { before, after: timeline };
      },
      () => {
        this.#undoablesQueued--;
        return edited;
      },
    );
  };

  /**
   * Undoes the latest edit, once the edits queued before it are saved.
   * Resolves to what it did, or null if there was nothing to undo or it
   * wasn't saved. An undo pressed for a Cue edit that then failed, so was
   * taken back, undoes nothing.
   */
  undo = (): Promise<Undone | null> => {
    if (!this.canUndo && this.#undoablesQueued === 0) return Promise.resolve(null);
    const failedBefore = this.#cueEditsFailed;
    return this.#step(() => {
      if (this.#cueEditsFailed !== failedBefore) return null;
      const edit = this.#history.nextUndo();
      if (!edit) return null;
      const playhead = this.#history.nextUndoPlayhead();
      return {
        edit,
        done: ({ before, after }) => {
          const back = this.#history.undone(before, after);
          // Clips deleted together come back as they were, selected.
          const reselect = edit.kind === 'placeClips' || edit.kind === 'replaceClips' ? back : null;
          return { before, after, reselect, playhead };
        },
      };
    });
  };

  /** Redoes the latest edit undone, like undo. */
  redo = (): Promise<Undone | null> => {
    if (!this.canRedo) return Promise.resolve(null);
    return this.#step(() => {
      const edit = this.#history.nextRedo();
      if (!edit) return null;
      return {
        edit,
        done: ({ before, after }) => {
          // A Merge redone selects its Clip again, and a Split its right halves, as they did.
          const reselect = this.#history.redone(before, after);
          return { before, after, reselect, playhead: null };
        },
      };
    });
  };

  /**
   * Queues an undo or a redo: in its turn, next gives the edit to send and
   * what it did, or null if there's nothing to.
   */
  #step(next: () => Step | null): Promise<Undone | null> {
    let undone: Undone | null = null;
    return this.#turn(
      async (at) => {
        const step = next();
        if (!step) return null;
        const before = this.timeline;
        return { step, before, after: await this.#send(at, step.edit) };
      },
      (sent) => {
        if (!sent) return;
        const { step, before, after } = sent;
        let timeline = before;
        if ('tracks' in after) this.#showTimeline((timeline = after));
        // A Cue edit leaves the Timeline as it was.
        else this.#saved = after;
        undone = step.done({ before, after: timeline });
        this.#showHistory();
      },
      () => undone,
    );
  }

  /**
   * Sends an edit kept to undo or redo, giving the Timeline it leaves, or
   * for a Cue edit the Song. Cues whose Line is gone since, or can't take
   * one, can't come back: with none left, nothing is sent, and the Song is
   * as it was.
   */
  async #send(at: Song, edit: HistoryEdit): Promise<Timeline | Song> {
    if (edit.kind !== 'restoreCues') return this.#server.apply(at, edit);
    const cues = restorable(edit.cues, at);
    return cues.length > 0 ? this.#server.apply(at, { kind: 'restoreCues', cues }) : at;
  }

  /** Shows the Timeline an edit left, which moved the Song on too. */
  #showTimeline(timeline: Timeline) {
    this.timeline = timeline;
    this.#saved = { ...this.#saved, version: timeline.version, updatedAt: timeline.updatedAt };
  }

  #showHistory() {
    this.canUndo = this.#history.nextUndo() !== null;
    this.canRedo = this.#history.nextRedo() !== null;
  }

  /** Forgets every edit kept, e.g. once the Song changed elsewhere. */
  #forget() {
    this.#history.clear();
    this.#showHistory();
  }

  /**
   * Queues setting the Song's Tags, which leaves its version as it was.
   * Resolves to the Tags as saved, in order and spelled as the Tags they
   * matched are, or null if they weren't.
   */
  setTags = (tags: string[]): Promise<string[] | null> => {
    let saved: string[] | null = null;
    return this.#turn(
      () => this.#server.setTags(tags),
      (s) => {
        saved = s;
        this.#saved = { ...this.#saved, tags: s };
      },
      () => saved,
    );
  };

  /**
   * Makes a Cue change at once, and queues its save. If it still fails
   * after trying again, it's taken back, and the save error names what,
   * given as e.g. "the Cue of Line 3 of Verse". Refused because the Song
   * changed elsewhere, it stays shown like any edit not saved. Resolves to
   * whether it was saved.
   */
  cue = (change: CueChange, what: string): Promise<boolean> => {
    if (this.#closed) return Promise.resolve(false);
    const unsaved = { change };
    this.#unsavedCues = [...this.#unsavedCues, unsaved];
    const settle = () => (this.#unsavedCues = this.#unsavedCues.filter((u) => u !== unsaved));
    this.#undoablesQueued++;
    const op = async (saved: Song): Promise<Song> => {
      try {
        let tries = 0;
        const after = await savedRetrying(() => (tries++, this.#server.apply(saved, change)), this.#wait).catch((e) =>
          tries > 1 && e instanceof ApiError && e.stale ? this.#landedEarlier(saved, change, e) : Promise.reject(e),
        );
        // Shown as saved in the same step it stops being made on top, so
        // it's never made twice over.
        this.#saved = after;
        settle();
        // Kept to undo as what it changed in the Song as saved, whatever
        // Cue changes not saved yet the Song shown has.
        this.#history.recordCues(saved, after);
        this.#showHistory();
        return after;
      } catch (e) {
        this.#cueEditsFailed++;
        if (e instanceof ApiError && e.stale) throw e;
        settle();
        // Saves already waiting behind it don't clear what was taken back,
        // e.g. the Lines cued meanwhile in Sync mode: only one asked for since.
        this.#errorKeptUntil = this.#turns;
        throw new Error(`Couldn't save ${what}, so it was taken back. ${(e as Error).message}`);
      }
    };
    return this.#turn(
      op,
      () => {},
      (ended) => {
        this.#undoablesQueued--;
        return ended === 'saved';
      },
    );
  };

  /**
   * The Song a Cue change left, when trying it again was refused as the Song
   * changed meanwhile, and that change was its own first try, saved though
   * its answer never came back. Otherwise it was changed elsewhere after all.
   */
  async #landedEarlier(saved: Song, change: CueChange, refused: ApiError): Promise<Song> {
    const latest = await this.#server.getSong().catch(() => null);
    if (latest?.version === saved.version + 1 && sameCues(latest, withCueChange(saved, change))) return latest;
    throw refused;
  }

  /** Shows an error found before saving, e.g. a field typed wrong, until a later save lands. */
  report = (message: string) => {
    this.saveError = message;
  };

  /**
   * Shows the Song as changed elsewhere since, e.g. on coming back to the
   * tab. It waits for saves already on their way, and never replaces edits
   * not saved yet: those are built against the Song as it was, so the Song
   * is marked stale instead. While held, it waits until released.
   */
  refresh = (): Promise<void> => {
    if (this.#closed) return Promise.resolve();
    if (this.#holds > 0) {
      this.#refreshOnRelease = true;
      return Promise.resolve();
    }
    const done = this.#queue.then(async () => {
      try {
        const latest = await this.#server.getSong();
        if (latest.version === this.#saved.version) return;
        if (this.unsaved) {
          this.stale = true;
          return;
        }
        const timeline = await this.#server.getTimeline();
        this.#onReplace(latest);
        this.#saved = latest;
        this.timeline = timeline;
        this.stale = false;
        this.#forget();
        this.replaced++;
      } catch {
        // Keep showing the Song as it was; the next save reports any problem.
      }
    });
    this.#queue = done.then(hop);
    return done;
  };

  /**
   * Holds refreshes, e.g. while recording, as the Timeline a Take is made
   * against has to stay as it is. Returns the release; a refresh asked for
   * meanwhile runs once nothing holds them.
   */
  hold = (): (() => void) => {
    this.#holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holds--;
      if (this.#holds > 0 || !this.#refreshOnRelease) return;
      this.#refreshOnRelease = false;
      void this.refresh();
    };
  };

  /**
   * Deletes the Song once the saves queued have landed, so none lands after
   * it. From then on nothing is sent: every save resolves as not saved. If
   * the delete fails, Saves opens again. Resolves to whether it was deleted.
   */
  close = async (deleteSend: (saved: Song) => Promise<unknown>): Promise<boolean> => {
    this.#closed = true;
    try {
      await this.#queue;
      await deleteSend(this.#saved);
      return true;
    } catch (e) {
      this.#fail(e);
      this.#closed = false;
      return false;
    }
  };

  /**
   * Queues a turn: op runs against the Song as saved once the turns before
   * it are over, show shows what it returns, and the result says how it
   * ended to the caller. Never rejects.
   */
  #turn<T, R>(op: (saved: Song) => Promise<T>, show: (result: T) => void, result: (ended: Submitted) => R): Promise<R> {
    if (this.#closed) return Promise.resolve(result('closed'));
    this.pending++;
    const turn = ++this.#turns;
    const done = this.#queue.then(async (): Promise<R> => {
      try {
        show(await op(this.#saved));
        if (turn > this.#errorKeptUntil) this.saveError = null;
        return result('saved');
      } catch (e) {
        return result(this.#fail(e));
      } finally {
        this.pending--;
      }
    });
    this.#queue = done.then(hop);
    return done;
  }

  #fail(e: unknown): Submitted {
    if (e instanceof ApiError && e.stale) {
      this.stale = true;
      this.#forget();
      return 'stale';
    }
    this.saveError = (e as Error).message;
    return 'failed';
  }
}

/**
 * The gap between turns: a caller awaiting a turn's result runs its code,
 * up to its next await, before the next turn starts.
 */
const hop = () => Promise.resolve();

/** An undo or a redo to send: the edit kept for it, and what it did once sent. */
interface Step {
  edit: HistoryEdit;
  done: (edited: Edited) => Undone;
}
