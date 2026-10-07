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
import { ApiError, type Song, type Timeline } from './api';
import { sameCues, savedRetrying, withCueChange, type CueChange } from './cueChanges';
import type { Saved } from './history';
import { waitFor, type SongServer, type Wait } from './songServer';

/** How a save ended: saved, failed, refused as the Song changed elsewhere, or never sent as the Song's being deleted. */
export type Submitted = 'saved' | 'failed' | 'stale' | 'closed';

/**
 * Lets the Timeline note Cue changes in its undo history. Temporary: the
 * undo history moves into Saves next (#709), and this goes.
 */
export interface CueHook {
  /** A Cue change was asked for, before it's queued. */
  asked(): void;
  /** It landed: the Song as saved before it, and the Song it left. */
  landed(before: Song, after: Song): void;
  /** It failed, with the error the save error shows, or a stale refusal. */
  failed(error: unknown): void;
  /** It's over, saved or not. */
  settled(): void;
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
  replacing?: (song: Song) => void;
}

export class Saves {
  #server: SongServer;
  #wait: Wait;
  #editsOutside: () => boolean;
  #replacing: (song: Song) => void;

  #saved: Song = $state.raw()!;
  /** Cue changes not saved yet, in the order they were made. */
  #unsavedCues: { change: CueChange }[] = $state.raw([]);
  #shown = $derived(this.#unsavedCues.reduce((s, u) => withCueChange(s, u.change), this.#saved));

  /** The Timeline as saved. */
  timeline: Timeline = $state.raw()!;
  /** Whether a save was refused, or a refresh couldn't be shown, because the Song changed elsewhere since it loaded. */
  stale = $state(false);
  /** Why the latest save failed, until a later one lands. */
  saveError = $state<string | null>(null);
  /** How many saves are queued or on their way. */
  pending = $state(0);

  /**
   * Temporary, until #709: the Timeline's hook into Cue changes, to keep
   * them in its undo history.
   */
  cueHook: CueHook | null = null;

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
    this.#replacing = options.replacing ?? (() => {});
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

  /** Whether anything isn't saved yet: saves on their way, Cue changes, or edits outside Saves. */
  get unsaved(): boolean {
    return this.pending > 0 || this.#unsavedCues.length > 0 || this.#editsOutside();
  }

  /**
   * Queues a change to the Song, built against the Song as saved when its
   * turn comes, and shows the Song it returns. Resolves to whether it was saved.
   */
  change = (op: (saved: Song) => Promise<Song>): Promise<boolean> =>
    this.#turn(
      op,
      (s) => (this.#saved = s),
      (ended) => ended === 'saved',
    );

  /** Queues a change like change, resolving to how it ended. */
  submit = (op: (saved: Song) => Promise<Song>): Promise<Submitted> =>
    this.#turn(
      op,
      (s) => (this.#saved = s),
      (ended) => ended,
    );

  /**
   * Temporary, until #709: queues one of the Timeline's saves as it builds
   * it, and shows the Timeline it returns, or for a Cue edit the Song.
   */
  send = (op: (saved: Song) => Promise<Saved>): Promise<boolean> =>
    this.#turn(
      op,
      (saved) => {
        if ('song' in saved) {
          this.#saved = saved.song;
          return;
        }
        this.timeline = saved.timeline;
        // The change moved the Song on too.
        this.#saved = { ...this.#saved, version: saved.timeline.version, updatedAt: saved.timeline.updatedAt };
      },
      (ended) => ended === 'saved',
    );

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
    const hook = this.cueHook;
    hook?.asked();
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
        hook?.landed(saved, after);
        return after;
      } catch (e) {
        if (e instanceof ApiError && e.stale) {
          hook?.failed(e);
          throw e;
        }
        settle();
        // Saves already waiting behind it don't clear what was taken back,
        // e.g. the Lines cued meanwhile in Sync mode: only one asked for since.
        this.#errorKeptUntil = this.#turns;
        const takenBack = new Error(`Couldn't save ${what}, so it was taken back. ${(e as Error).message}`);
        hook?.failed(takenBack);
        throw takenBack;
      }
    };
    const done = this.#turn(
      op,
      () => {},
      (ended) => ended === 'saved',
    );
    if (hook) void done.then(() => hook.settled());
    return done;
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
        this.#replacing(latest);
        this.#saved = latest;
        this.timeline = timeline;
        this.stale = false;
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
